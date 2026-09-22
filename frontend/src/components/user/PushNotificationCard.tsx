import type { PushSubscriptionStatus } from "../../services/pushSubscription";

type PushNotificationCardProps = {
  status: PushSubscriptionStatus;
  error: string;
  onEnable: () => void;
  onRetry: () => void;
};

export default function PushNotificationCard({
  status,
  error,
  onEnable,
  onRetry,
}: PushNotificationCardProps) {
  if (status === "unsupported" || status === "unconfigured") return null;

  if (status === "subscribed") {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
        <strong className="text-emerald-900">안심 알림이 켜져 있어요</strong>
        <p className="mt-1 text-stone-600">도움이 필요할 때 이 기기로 알려드릴게요.</p>
      </section>
    );
  }

  const denied = status === "denied";
  return (
    <section
      className="min-w-0 rounded-3xl border border-stone-200 bg-white p-6 shadow-[0_2px_10px_rgb(15_23_42_/_3%)] max-[359px]:p-5"
      aria-labelledby="push-title"
    >
      <h2 className="text-xl font-bold" id="push-title">
        안심 알림 받기
      </h2>
      <p className="mt-2 text-stone-600">
        {denied
          ? "브라우저 설정에서 이 서비스의 알림을 허용한 뒤 다시 확인해 주세요."
          : "위험 신호가 확인되면 바로 알려드릴 수 있도록 알림을 켜 주세요."}
      </p>
      {status === "error" && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-red-700" role="alert">
          {error}
        </p>
      )}
      <button
        className="mt-5 flex min-h-16 w-full items-center justify-center rounded-2xl border border-stone-300 bg-white px-4 py-3.5 text-center text-[1.3125rem] leading-6 font-semibold text-stone-800 shadow-[0_4px_0_#d6d3d1,0_7px_14px_rgb(15_23_42_/_6%)] transition-[transform,box-shadow,background-color] duration-150 hover:not-disabled:bg-stone-50 active:not-disabled:translate-y-[3px] active:not-disabled:shadow-[0_1px_0_#d6d3d1,0_3px_6px_rgb(15_23_42_/_6%)] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
        disabled={status === "syncing"}
        onClick={status === "error" || denied ? onRetry : onEnable}
      >
        {status === "syncing" ? "알림 설정 확인 중…" : denied ? "다시 확인하기" : "알림 켜기"}
      </button>
    </section>
  );
}
