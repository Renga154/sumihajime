/**
 * スミハジメ 外形監視（docs/ROADMAP.md A-1-4 / 運用手順 docs/ops/monitoring.md）
 *
 * Google Apps Script の時間主導トリガーで15分ごとに動き、正典とミラーについて
 *   1. /api/health が 200 かつ status === 'ok'（判定の中身はサーバー側 apps/api/src/health.ts）
 *   2. トップページが 200
 *   3. チェックリスト作成（合成の条件）が 200 で、タスクが1件以上
 * を確かめる。状態が変わったときだけ、このスクリプトの持ち主の Gmail へ通知する。
 *
 * なぜ Apps Script か: 正典は Workers Free で、Cloudflare 側に通知手段が無い。
 * 新しいアカウントを作らず、無料で、落ちた Worker の外から見られる場所がここだった。
 * 判定をここに書かないのは、このファイルはリポジトリの外で動きテストされないため。
 *
 * このファイルを変えたら、Apps Script エディタへ貼り直す（自動では同期されない）。
 */

var TARGETS = [
  { name: '正典', base: 'https://sumihajime.com' },
  { name: 'ミラー（提供環境）', base: 'https://sumihajime.tokyo-odh-145.workers.dev' },
];

/** 15分×2回続いたら通知する（一過性の揺れで起こさない）。 */
var FAILS_BEFORE_ALERT = 2;

/** 合成の条件（実在の人の情報ではない）。千代田区・単身・都外から。 */
var SMOKE_PROFILE = {
  destination: { municipalityCode: '13101' },
  moveDate: '2026-10-01',
  originType: 'outside_tokyo',
  household: { memberCount: 1, ageBands: ['adult'] },
  flags: {
    hasMyNumberCard: true,
    needsNationalHealthInsurance: false,
    needsNationalPension: false,
    hasSchoolOrChildcareNeeds: false,
    hasDog: false,
    dogHasMicrochip: 'unknown',
    needsDisabilityOrCareSupport: false,
    needsForeignResidentGuidance: false,
    needsVehicleGuidance: false,
    isPregnantMember: false,
  },
};

/** トリガーから15分ごとに呼ばれる。手動実行してもよい（通知は状態が変わったときだけ）。 */
function checkNow() {
  var props = PropertiesService.getScriptProperties();
  var summary = [];
  TARGETS.forEach(function (t) {
    var problems = probe_(t.base);
    var key = 'state:' + t.base;
    var prev = JSON.parse(props.getProperty(key) || '{"fails":0,"alerted":false}');
    if (problems.length === 0) {
      if (prev.alerted) {
        notify_('[スミハジメ] 復旧: ' + t.name, t.base + ' は正常に戻りました。');
      }
      props.setProperty(key, JSON.stringify({ fails: 0, alerted: false }));
    } else {
      var fails = prev.fails + 1;
      var alerted = prev.alerted;
      if (!alerted && fails >= FAILS_BEFORE_ALERT) {
        notify_(
          '[スミハジメ] 異常: ' + t.name,
          t.base +
            ' で次の異常が ' +
            fails * 15 +
            ' 分ほど続いています。\n\n- ' +
            problems.join('\n- '),
        );
        alerted = true;
      }
      props.setProperty(key, JSON.stringify({ fails: fails, alerted: alerted }));
    }
    summary.push(t.name + ': ' + (problems.length ? problems.join(' / ') : 'OK'));
  });
  console.log(summary.join('\n'));
  return summary;
}

function probe_(base) {
  var problems = [];
  var opt = { muteHttpExceptions: true, followRedirects: true };

  try {
    var h = UrlFetchApp.fetch(base + '/api/health', opt);
    if (h.getResponseCode() !== 200) {
      problems.push('/api/health が HTTP ' + h.getResponseCode());
    } else {
      var body = JSON.parse(h.getContentText());
      if (body.status !== 'ok') {
        problems.push(
          '/api/health の自己判定が ' + body.status + '（' + (body.issues || []).join(', ') + '）',
        );
      }
    }
  } catch (e) {
    problems.push('/api/health に接続できない: ' + e.message);
  }

  try {
    var top = UrlFetchApp.fetch(base + '/', opt);
    if (top.getResponseCode() !== 200)
      problems.push('トップページが HTTP ' + top.getResponseCode());
  } catch (e) {
    problems.push('トップページに接続できない: ' + e.message);
  }

  try {
    var c = UrlFetchApp.fetch(base + '/api/checklists', {
      muteHttpExceptions: true,
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(SMOKE_PROFILE),
    });
    if (c.getResponseCode() !== 200) {
      problems.push('チェックリスト作成が HTTP ' + c.getResponseCode());
    } else if (!(JSON.parse(c.getContentText()).tasks || []).length) {
      problems.push('チェックリストが空で返る');
    }
  } catch (e) {
    problems.push('チェックリスト作成に接続できない: ' + e.message);
  }

  return problems;
}

function notify_(subject, body) {
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    subject,
    body + '\n\n運用手順: リポジトリの docs/ops/monitoring.md',
  );
}

/** 初回に1度だけ手動実行する。15分トリガーを（重複させずに）登録し、開始通知を送る。 */
function setup() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      return t.getHandlerFunction() === 'checkNow';
    })
    .forEach(function (t) {
      ScriptApp.deleteTrigger(t);
    });
  ScriptApp.newTrigger('checkNow').timeBased().everyMinutes(15).create();
  var summary = checkNow();
  notify_(
    '[スミハジメ] 外形監視を開始しました',
    '15分ごとに正典とミラーを確認し、異常が30分続いたとき・復旧したときだけ通知します。\n\n現在の状態:\n' +
      summary.join('\n'),
  );
}
