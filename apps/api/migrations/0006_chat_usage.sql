-- Migration 0006: チャットの全体1日上限(OpenAI 課金の上限)。
--
-- chat_usage
--   日本時間の暦日(day = YYYY-MM-DD)ごとに1行。生成(埋め込み+チャット補完)を伴う /api/chat の
--   受付件数を数える。apps/api/src/chat.ts が1要求ごとに
--     INSERT ... ON CONFLICT(day) DO UPDATE SET count = count + 1 RETURNING count
--   で原子的に加算し、CHAT_DAILY_LIMIT を超えたら 429 で断る。
--
--   なぜ D1 か: 既存の IP 単位の制限はメモリ内で isolate ごとにしか効かず、IPを替えれば
--   すり抜けられる。費用の上限は全体で1つの数を持たないと守れない。
--   なぜ個人を識別する列を持たないか: 数えるのは日付ごとの総数だけで足りる(IP・質問文は
--   保存しない。CLAUDE.md 原則7)。
--
--   publish の DELETE→INSERT 対象(scripts/publish/src/sql.ts の TABLES)には含めない
--   (公開データではない。再publish で当日の計数が消えると上限がリセットされてしまう)。

CREATE TABLE chat_usage (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);
