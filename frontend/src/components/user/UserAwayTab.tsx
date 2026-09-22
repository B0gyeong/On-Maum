import type { MyDashboard } from "../../types/monitoring";
import AwaySettings from "./AwaySettings";
import type { AwayDraft } from "./AwaySettings";
import UserTabStatus from "./UserTabStatus";
import type { UserTabStatusProps } from "./UserTabStatus";

type UserAwayTabProps = {
  draft: AwayDraft;
  mode?: MyDashboard["awayMode"];
  busy: boolean;
  dataAvailable: boolean;
  comparison: boolean;
  status: UserTabStatusProps;
  onDraftChange: (draft: AwayDraft) => void;
  onUpdateAway: (enabled: boolean) => void;
};

export default function UserAwayTab({
  draft,
  mode,
  busy,
  dataAvailable,
  comparison,
  status,
  onDraftChange,
  onUpdateAway,
}: UserAwayTabProps) {
  return (
    <>
      <div>
        <h1 className="text-center text-3xl leading-snug font-bold">외출 시간 정하기</h1>
        {comparison && (
          <p className="mt-2 text-sm font-semibold text-brand-700">기존 디자인 비교 화면</p>
        )}
      </div>
      <UserTabStatus {...status} />
      <AwaySettings
        draft={draft}
        mode={mode}
        busy={busy}
        dataAvailable={dataAvailable}
        onDraftChange={onDraftChange}
        onUpdateAway={onUpdateAway}
      />
    </>
  );
}
