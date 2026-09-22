import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiErrorMessage } from "../api/client";
import { clearSession } from "../api/tokenStorage";
import type { AwayDraft } from "../components/user/AwaySettings";
import UserAwayTab from "../components/user/UserAwayTab";
import UserHeader from "../components/user/UserHeader";
import UserHomeTab from "../components/user/UserHomeTab";
import UserNavigation from "../components/user/UserNavigation";
import type { UserTabStatusProps } from "../components/user/UserTabStatus";
import type { UserTab } from "../components/user/UserNavigation";
import {
  useAwayModeMutation,
  useMyDashboardQuery,
  useNotificationResponseMutation,
} from "../hooks/api";
import { usePendingNotification } from "../hooks/notifications/usePendingNotification";
import { usePushSubscription } from "../hooks/notifications/usePushSubscription";

export default function UserPage({ comparison = false }: { comparison?: boolean }) {
  const navigate = useNavigate();
  const dashboard = useMyDashboardQuery();
  const awayMutation = useAwayModeMutation();
  const responseMutation = useNotificationResponseMutation();
  const [feedback, setFeedback] = useState("");
  const [tab, setTab] = useState<UserTab>("home");
  const [awayDraft, setAwayDraft] = useState<AwayDraft>({ duration: 60 });
  const { notificationId, clearNotification } = usePendingNotification();
  const pushSubscription = usePushSubscription();
  const data = dashboard.data;
  const busy = awayMutation.isPending || responseMutation.isPending;

  const updateAway = async (enabled: boolean) => {
    if (
      enabled &&
      (!Number.isInteger(awayDraft.duration) || awayDraft.duration < 1 || awayDraft.duration > 1440)
    ) {
      setFeedback("외출 시간을 1~1440분 사이로 입력해 주세요.");
      return;
    }
    try {
      await awayMutation.mutateAsync(
        enabled
          ? {
              enabled,
              endsAt: new Date(Date.now() + awayDraft.duration * 60_000).toISOString(),
            }
          : { enabled },
      );
      setFeedback(enabled ? "외출 설정을 저장했습니다." : "외출 모드를 해제했습니다.");
      if (enabled) setTab("home");
    } catch (cause) {
      setFeedback(getApiErrorMessage(cause));
    }
  };

  const answer = async (value: "yes" | "no") => {
    if (!notificationId) return;
    try {
      await responseMutation.mutateAsync({ notificationId, answer: value });
      setFeedback(value === "yes" ? "도움 요청이 접수됐어요." : "괜찮다는 응답이 접수됐어요.");
      clearNotification();
    } catch (cause) {
      setFeedback(getApiErrorMessage(cause));
    }
  };

  const logout = async () => {
    await Promise.allSettled([pushSubscription.unsubscribe()]);
    clearSession();
    navigate("/");
  };

  const tabStatus: UserTabStatusProps = {
    dashboardError: dashboard.isError ? getApiErrorMessage(dashboard.error) : "",
    notificationPending: Boolean(notificationId),
    busy,
    dataAvailable: Boolean(data),
    pushStatus: pushSubscription.status,
    pushError: pushSubscription.error,
    feedback,
    onRetryDashboard: () => void dashboard.refetch(),
    onAnswerNotification: (value) => void answer(value),
    onEnablePush: () => void pushSubscription.enable(),
    onRetryPush: () => void pushSubscription.retry(),
    onClearFeedback: () => setFeedback(""),
  };

  return (
    <main
      className={`min-h-screen bg-stone-50 pb-[calc(7rem+env(safe-area-inset-bottom))] text-xl leading-[1.6] text-stone-800 [overflow-wrap:anywhere] ${comparison ? "selection:bg-brand-200" : ""}`}
    >
      <UserHeader onLogout={logout} />
      <div className="mx-auto grid max-w-xl gap-5 px-5">
        {tab === "home" ? (
          <UserHomeTab
            data={data}
            comparison={comparison}
            busy={busy}
            status={tabStatus}
            onUpdateAway={(enabled) => void updateAway(enabled)}
            onOpenAwaySettings={() => setTab("away")}
          />
        ) : (
          <UserAwayTab
            draft={awayDraft}
            mode={data?.awayMode}
            busy={busy}
            dataAvailable={Boolean(data)}
            comparison={comparison}
            status={tabStatus}
            onDraftChange={setAwayDraft}
            onUpdateAway={(enabled) => void updateAway(enabled)}
          />
        )}
      </div>
      <UserNavigation tab={tab} onChange={setTab} />
    </main>
  );
}
