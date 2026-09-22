import type { PushSubscriptionStatus } from "../../services/pushSubscription";
import NotificationPrompt from "./NotificationPrompt";
import PushNotificationCard from "./PushNotificationCard";

export type UserTabStatusProps = {
  dashboardError: string;
  notificationPending: boolean;
  busy: boolean;
  dataAvailable: boolean;
  pushStatus: PushSubscriptionStatus;
  pushError: string;
  feedback: string;
  onRetryDashboard: () => void;
  onAnswerNotification: (answer: "yes" | "no") => void;
  onEnablePush: () => void;
  onRetryPush: () => void;
  onClearFeedback: () => void;
};

export default function UserTabStatus({
  dashboardError,
  notificationPending,
  busy,
  dataAvailable,
  pushStatus,
  pushError,
  feedback,
  onRetryDashboard,
  onAnswerNotification,
  onEnablePush,
  onRetryPush,
  onClearFeedback,
}: UserTabStatusProps) {
  return (
    <>
      {dashboardError && (
        <div className="rounded-xl bg-red-50 p-4 text-red-700" role="alert">
          <p>{dashboardError}</p>
          <button className="mt-2 font-bold underline" onClick={onRetryDashboard}>
            다시 불러오기
          </button>
        </div>
      )}
      {notificationPending && (
        <NotificationPrompt
          disabled={busy || !dataAvailable}
          onAnswer={onAnswerNotification}
        />
      )}
      <PushNotificationCard
        status={pushStatus}
        error={pushError}
        onEnable={onEnablePush}
        onRetry={onRetryPush}
      />
      {feedback && (
        <div
          className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4"
          role="status"
        >
          <p className="flex-1 text-stone-800">{feedback}</p>
          <button
            className="min-h-12 rounded-xl px-3 py-2 text-lg font-medium text-stone-600 transition-colors hover:bg-stone-100"
            onClick={onClearFeedback}
          >
            확인하기
          </button>
        </div>
      )}
    </>
  );
}
