import phoneImage from "../../assets/user/phone.svg";
import walkImage from "../../assets/user/walk.svg";
import type { MyDashboard } from "../../types/monitoring";
import { formatShortDateTime, telephoneHref } from "../../utils/format";
import Icon from "../common/Icon";

type UserDashboardProps = {
  data?: MyDashboard;
  busy: boolean;
  onUpdateAway: (enabled: boolean) => void;
  onOpenAwaySettings: () => void;
};

export default function UserDashboard({
  data,
  busy,
  onUpdateAway,
  onOpenAwaySettings,
}: UserDashboardProps) {
  const mode = data?.awayMode;
  const hasAwayMode = Boolean(mode?.enabled);

  return (
    <>
      {(!data || mode?.enabled) && (
        <div className="rounded-xl bg-stone-100 p-4" role="status">
          <strong className="text-xl">{!data ? "정보를 불러오고 있어요" : "외출 중입니다"}</strong>
          {mode?.enabled && (
            <p className="mt-1 text-lg text-stone-600">{formatShortDateTime(mode.until)}까지</p>
          )}
        </div>
      )}
      {hasAwayMode ? (
        <button
          className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-2xl border border-brand-600 bg-brand-500 px-4 py-3.5 text-center text-2xl leading-6 font-semibold text-white shadow-[0_4px_0_#bd4d0d,0_7px_14px_rgb(243_121_41_/_20%)] transition-[transform,box-shadow,background-color] duration-150 hover:not-disabled:bg-[#e86b1d] active:not-disabled:translate-y-[3px] active:not-disabled:shadow-[0_1px_0_#bd4d0d,0_3px_6px_rgb(74_54_35_/_8%)] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
          disabled={busy}
          onClick={() => onUpdateAway(false)}
        >
          <Icon name="home" />
          {busy ? "처리 중…" : "집에 돌아왔어요"}
        </button>
      ) : (
        <button
          className="flex min-h-16 w-full items-center justify-between gap-2.5 rounded-full border border-[#d95e12] bg-[linear-gradient(180deg,#f99552_0%,#f37929_58%,#e8661b_100%)] px-7 py-3.5 text-center text-2xl leading-6 font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_32%),0_4px_0_#bd4d0d,0_9px_18px_rgb(120_63_27_/_18%)] transition-[transform,box-shadow,filter] duration-150 hover:not-disabled:brightness-[1.02] active:not-disabled:translate-y-[3px] active:not-disabled:brightness-[.97] active:not-disabled:shadow-[inset_0_1px_0_rgb(255_255_255_/_18%),0_1px_0_#bd4d0d,0_4px_8px_rgb(120_63_27_/_12%)] disabled:cursor-not-allowed disabled:border-[#c75a17] disabled:text-white disabled:brightness-[.9] disabled:shadow-none"
          disabled={!data || busy}
          onClick={onOpenAwaySettings}
        >
          <div className="size-10">
            <img src={walkImage} alt="" aria-hidden="true" />
          </div>
          <span>외출하기</span>
        </button>
      )}
      <section
        className="min-w-0 rounded-3xl border border-stone-200 bg-white p-6 shadow-[0_2px_10px_rgb(15_23_42_/_3%)] max-[359px]:p-5"
        aria-labelledby="contact-title"
      >
        {data?.manager ? (
          <>
            <div className="flex items-center gap-4">
              <p className="text-2xl font-bold">
                {data.manager.name}
                <span className="text-lg font-normal"> 담당자</span>
              </p>
            </div>
            {data.manager.phone ? (
              <>
                <p className="my-2 text-lg text-stone-600">{data.manager.phone}</p>
                <a
                  className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full border border-stone-300 bg-[linear-gradient(180deg,#ffffff_0%,#fafaf9_58%,#f1f0ee_100%)] px-7 py-3.5 text-center text-[1.3125rem] leading-6 font-semibold text-stone-800 no-underline shadow-[inset_0_1px_0_rgb(255_255_255_/_90%),0_4px_0_#d6d3d1,0_9px_18px_rgb(15_23_42_/_10%)] transition-[transform,box-shadow,filter] duration-150 hover:brightness-[.99] active:translate-y-[3px] active:shadow-[inset_0_1px_0_rgb(255_255_255_/_70%),0_1px_0_#d6d3d1,0_4px_8px_rgb(15_23_42_/_8%)]"
                  href={telephoneHref(data.manager.phone)}
                >
                  <img className="h-7 w-7" src={phoneImage} alt="" aria-hidden="true" />
                  담당자에게 전화하기
                </a>
              </>
            ) : (
              <p className="mt-4 text-stone-600">등록된 전화번호가 없습니다.</p>
            )}
          </>
        ) : (
          <p className="mt-4 text-stone-600">
            {data ? "아직 배정된 담당자가 없습니다." : "담당자 정보를 불러오고 있어요."}
          </p>
        )}
      </section>
    </>
  );
}
