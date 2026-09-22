import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getApiErrorMessage } from "../api/client";
import { clearSession } from "../api/tokenStorage";
import Icon from "../components/common/Icon";
import OverviewMetrics from "../components/staff/OverviewMetrics";
import RecentAlerts from "../components/staff/RecentAlerts";
import RegistrationForm from "../components/staff/RegistrationForm";
import StaffHeader from "../components/staff/StaffHeader";
import StaffPageHeading from "../components/staff/StaffPageHeading";
import StaffSidebar from "../components/staff/StaffSidebar";
import { staffNavigation } from "../components/staff/staffNavigation";
import type { StaffView } from "../components/staff/staffNavigation";
import StreamNotice from "../components/staff/StreamNotice";
import SubjectDetail from "../components/staff/SubjectDetail";
import SubjectList from "../components/staff/SubjectList";
import { useSubjectsQuery } from "../hooks/api";
import { useSubjectStream } from "../hooks/realtime/useSubjectStream";
import { unsubscribeFromPush } from "../services/pushSubscription";

export default function StaffPage() {
  const navigate = useNavigate();
  const { subjectId } = useParams();
  const [searchParams] = useSearchParams();
  const query = useSubjectsQuery();
  const stream = useSubjectStream();
  const [registering, setRegistering] = useState(false);
  const [feedback, setFeedback] = useState("");
  const subjects = useMemo(() => query.data?.subjects ?? [], [query.data?.subjects]);
  const requestedView = searchParams.get("view");
  const view: StaffView = staffNavigation.some((item) => item.key === requestedView)
    ? (requestedView as StaffView)
    : "overview";
  const selected = subjects.find((subject) => subject.subjectId === subjectId);
  const title = subjectId
    ? "대상자 상세"
    : staffNavigation.find((item) => item.key === view)?.label;

  const logout = async () => {
    await Promise.allSettled([unsubscribeFromPush()]);
    clearSession();
    navigate("/");
  };

  return (
    <main className="min-h-screen bg-stone-100 text-stone-800 lg:grid lg:grid-cols-[250px_1fr]">
      <StaffSidebar view={view} subjectId={subjectId} onLogout={logout} />
      <div className="lg:col-start-2">
        <StaffHeader
          title={title}
          connection={stream.connection}
          refreshing={query.isFetching}
          onRefresh={() => void query.refetch()}
        />
        <div className="mx-auto grid max-w-7xl gap-5 p-5 md:p-8">
          {query.isError && (
            <p className="rounded-xl bg-red-50 p-4 text-red-700" role="alert">
              {getApiErrorMessage(query.error)}
            </p>
          )}
          {stream.connection === "disconnected" && (
            <p className="rounded-xl bg-amber-50 p-4 text-amber-800" role="status">
              실시간 연결이 끊겨 재연결 중입니다. {stream.error}
            </p>
          )}
          {stream.notice && (
            <StreamNotice
              notice={stream.notice}
              subjectName={
                subjects.find((subject) => subject.subjectId === stream.notice?.subjectId)?.name ??
                "대상자"
              }
              onClose={() => stream.setNotice(null)}
            />
          )}
          {subjectId ? (
            <>
              <Link
                className="flex w-fit items-center gap-2 font-semibold text-brand-700"
                to="/staff?view=subjects"
              >
                <Icon name="back" />
                대상자 목록
              </Link>
              {selected ? (
                <SubjectDetail subject={selected} />
              ) : (
                <section className="rounded-2xl bg-white p-10 text-center text-stone-500">
                  {query.isLoading
                    ? "대상자 정보를 불러오는 중입니다."
                    : "담당 대상자를 찾을 수 없습니다."}
                </section>
              )}
            </>
          ) : (
            <>
              <StaffPageHeading
                view={view}
                title={title}
                onToggleRegistration={() => setRegistering((value) => !value)}
              />
              {registering && (
                <RegistrationForm
                  onCancel={() => setRegistering(false)}
                  onDone={() => {
                    setRegistering(false);
                    setFeedback("대상자를 등록했습니다.");
                  }}
                />
              )}
              {view === "overview" && (
                <OverviewMetrics subjects={subjects} loading={query.isLoading} />
              )}
              {view === "alerts" ? (
                <RecentAlerts subjects={subjects} />
              ) : (
                <SubjectList
                  subjects={subjects}
                  loading={query.isLoading}
                  dataUpdatedAt={query.dataUpdatedAt}
                />
              )}
            </>
          )}
          {feedback && (
            <p
              className="fixed right-5 bottom-5 rounded-xl bg-stone-800 px-5 py-3 text-white shadow-lg"
              role="status"
            >
              {feedback}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
