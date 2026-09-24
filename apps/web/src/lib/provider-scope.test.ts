import { describe, expect, it } from 'vitest';
import { isNonMunicipal, providerScope, providerScopeLabel } from './provider-scope';

/**
 * なぜ: ADR-009。チェックリストの「区の手続き / 区以外の手続き」の区別は、UIの見た目ではなく
 * カテゴリだけを見る純関数で決まることを固定する(自治体固有の分岐を持たない)。
 */
describe('providerScope', () => {
  it.each(['water_supply', 'postal_forwarding', 'utilities_contact', 'driver_license'])(
    '%s は区以外の手続き',
    (category) => {
      expect(providerScope(category)).toBe('non_municipality');
      expect(isNonMunicipal(category)).toBe(true);
    },
  );

  it.each([
    'resident_registration',
    'my_number',
    'national_health_insurance',
    'national_pension',
    'child_benefits',
    'school_transfer',
    'childcare',
    'dog_registration',
    'waste_schedule',
  ])('%s は区の手続き', (category) => {
    expect(providerScope(category)).toBe('municipality');
    expect(isNonMunicipal(category)).toBe(false);
  });

  it('未知のカテゴリは区の手続き扱い(区以外だと断定しない)', () => {
    // なぜ: 新カテゴリが増えたときに、根拠なく「区以外」と表示してしまわないための安全側の既定。
    expect(providerScope('some_future_category')).toBe('municipality');
  });

  it('ラベルは利用者向けの平易な日本語', () => {
    expect(providerScopeLabel.municipality).toBe('市区町村の手続き');
    expect(providerScopeLabel.non_municipality).toBe('市区町村以外の手続き');
  });
});
