import type { MyDashboard } from "../../types/monitoring";
import Icon from "../common/Icon";

export type AwayDraft = {
  duration: number;
};

type AwaySettingsProps = {
  draft: AwayDraft;
  mode?: MyDashboard["awayMode"];
  busy: boolean;
  dataAvailable: boolean;
  onDraftChange: (draft: AwayDraft) => void;
  onUpdateAway: (enabled: boolean) => void;
};

export default function AwaySettings({
  draft,
  mode,
  busy,
  dataAvailable,
  onDraftChange,
  onUpdateAway,
}: AwaySettingsProps) {
  const hasAwayMode = Boolean(mode?.enabled);

  return (
    <section
      className="min-w-0 rounded-3xl border border-stone-200 bg-white p-6 shadow-[0_2px_10px_rgb(15_23_42_/_3%)] max-[359px]:p-5"
      aria-labelledby="away-title"
    >
      <h2 className="text-2xl font-bold" id="away-title">
        외출할 시간을 선택해 주세요
      </h2>
      <fieldset className="mt-5" disabled={busy}>
        <legend className="text-stone-600">외출 시간 선택</legend>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {[30, 60, 120, 240].map((minutes) => (
            <button
              type="button"
              className={
                draft.duration === minutes
                  ? "flex min-h-16 w-full items-center justify-center gap-2.5 rounded-2xl border border-brand-600 bg-brand-500 px-4 py-3.5 text-center text-[1.3125rem] leading-6 font-semibold text-white shadow-[0_4px_0_#bd4d0d,0_7px_14px_rgb(243_121_41_/_20%)] transition-[transform,box-shadow,background-color] duration-150 hover:not-disabled:bg-[#e86b1d] active:not-disabled:translate-y-[3px] active:not-disabled:shadow-[0_1px_0_#bd4d0d,0_3px_6px_rgb(74_54_35_/_8%)] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
                  : "flex min-h-16 w-full items-center justify-center gap-2.5 rounded-2xl border border-stone-300 bg-white px-4 py-3.5 text-center text-[1.3125rem] leading-6 font-semibold text-stone-800 shadow-[0_4px_0_#d6d3d1,0_7px_14px_rgb(15_23_42_/_6%)] transition-[transform,box-shadow,background-color] duration-150 hover:not-disabled:bg-stone-50 active:not-disabled:translate-y-[3px] active:not-disabled:shadow-[0_1px_0_#d6d3d1,0_3px_6px_rgb(15_23_42_/_6%)] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
              }
              key={minutes}
              aria-pressed={draft.duration === minutes}
              onClick={() => onDraftChange({ ...draft, duration: minutes })}
            >
              {draft.duration === minutes && <Icon name="check" />}
              {minutes < 60 ? `${minutes}분` : `${minutes / 60}시간`}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="mt-6 text-lg font-bold">
        지금 출발 ·{" "}
        {draft.duration >= 60 && draft.duration % 60 === 0
          ? `${draft.duration / 60}시간`
          : `${draft.duration}분`} 외출
      </p>
      <div className="mt-5 grid gap-3">
        <button
          className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-2xl border border-brand-600 bg-brand-500 px-4 py-3.5 text-center text-2xl leading-6 font-semibold text-white shadow-[0_4px_0_#bd4d0d,0_7px_14px_rgb(243_121_41_/_20%)] transition-[transform,box-shadow,background-color] duration-150 hover:not-disabled:bg-[#e86b1d] active:not-disabled:translate-y-[3px] active:not-disabled:shadow-[0_1px_0_#bd4d0d,0_3px_6px_rgb(74_54_35_/_8%)] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
          disabled={busy || !dataAvailable}
          onClick={() => onUpdateAway(true)}
        >
          <Icon name="walk" />
          {busy ? "저장 중…" : "지금 외출 시작하기"}
        </button>
        {hasAwayMode && (
          <button
            className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-2xl border border-stone-300 bg-white px-4 py-3.5 text-center text-[1.3125rem] leading-6 font-semibold text-stone-800 shadow-[0_4px_0_#d6d3d1,0_7px_14px_rgb(15_23_42_/_6%)] transition-[transform,box-shadow,background-color] duration-150 hover:not-disabled:bg-stone-50 active:not-disabled:translate-y-[3px] active:not-disabled:shadow-[0_1px_0_#d6d3d1,0_3px_6px_rgb(15_23_42_/_6%)] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
            disabled={busy}
            onClick={() => onUpdateAway(false)}
          >
            집에 돌아왔어요
          </button>
        )}
      </div>
      <p className="mt-4 text-stone-600">정한 시간이 지나면 외출 설정이 자동으로 해제돼요.</p>
      <div className="mt-6 grid gap-4 border-t border-stone-200 pt-5">
        <details className="group">
          <summary className="min-h-16 cursor-pointer rounded-2xl border border-stone-300 p-4 font-semibold text-stone-800 transition-colors hover:bg-stone-50">
            외출 시간 직접 입력하기
          </summary>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-2 font-semibold">
              외출 시간 (분)
              <input
                className="h-auto min-h-15 w-full min-w-0 rounded-xl border border-stone-400 bg-white p-3 text-stone-800"
                type="number"
                inputMode="numeric"
                min="1"
                max="1440"
                step="1"
                value={draft.duration || ""}
                disabled={busy}
                onChange={(event) =>
                  onDraftChange({ ...draft, duration: Number(event.target.value) })
                }
              />
            </label>
          </div>
        </details>
      </div>
    </section>
  );
}
