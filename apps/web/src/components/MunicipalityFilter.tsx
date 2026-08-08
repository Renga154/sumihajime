/**
 * なぜ: 自治体一覧(ランディング)と透明性ページ(/about-data)はどちらも62自治体を縦に
 * 並べるため、目的の自治体へ辿り着くまでのスクロールが体験の足かせになっていた。
 * 同じ絞り込み部品を両方で使い、操作の学習を1回で済ませる。
 *
 * アクセシビリティ: label を必ず可視で置き(プレースホルダを名前代わりにしない)、
 * 件数は aria-live で読み上げる。フォーカスリングは index.css の :focus-visible が共通で当たる。
 */
export function MunicipalityFilter({
  id,
  label,
  value,
  onChange,
  placeholder = '例: 練馬 / ねりま / nerima',
  hint,
  resultText,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  hint?: string;
  resultText: string;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-xs text-slate-500">
          {hint}
        </p>
      )}
      <div className="relative mt-1.5">
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 103.44 9.79l3.13 3.14a1 1 0 001.42-1.42l-3.14-3.13A5.5 5.5 0 009 3.5zM5.5 9a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0z"
            clipRule="evenodd"
          />
        </svg>
        <input
          id={id}
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-describedby={hintId}
          autoComplete="off"
          className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 transition-colors focus:border-brand-500"
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-600" aria-live="polite">
        {resultText}
      </p>
    </div>
  );
}
