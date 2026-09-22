import type { Subject } from "../../types/monitoring";
import { responseLabel, riskLabels } from "../../types/monitoring";
import { formatDateTime, riskBadgeClass } from "../../utils/format";
import Icon from "../common/Icon";

export function PreviewDangerAlert({ occurredAt, onClose }: { occurredAt: string; onClose: () => void }) {
  return (
    <aside
      className="fixed top-20 left-1/2 z-50 w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-red-200 bg-white p-4 shadow-[0_16px_40px_rgb(127_29_29_/_18%)]"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-600 text-white">
          <Icon name="bell" />
        </span>
        <div className="min-w-0 flex-1">
          <strong className="block text-red-900">박정수님의 위험 신호가 감지되었습니다.</strong>
          <p className="mt-1 text-sm leading-5 text-stone-600">
            장시간 활동이 확인되지 않았습니다. 즉시 안전 상태를 확인해 주세요.
          </p>
          <time className="mt-1 block text-xs text-stone-500">{formatDateTime(occurredAt)}</time>
        </div>
        <button
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-stone-500 hover:bg-stone-100"
          aria-label="알림 닫기"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <button className="mt-3 w-full rounded-xl bg-red-600 px-4 py-2.5 font-semibold text-white hover:bg-red-700">
        상태 확인
      </button>
    </aside>
  );
}

export function PreviewSubjectTable({ subjects }: { subjects: Subject[] }) {
  const sortedSubjects = [...subjects].sort((a, b) => b.riskScore - a.riskScore);

  return (
    <section className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-100 p-5">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Icon name="users" /> 등록 대상자
        </h2>
        <p className="mt-1 text-sm text-stone-500">위험 점수가 높은 순서로 표시됩니다.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-4xl text-left">
          <thead className="bg-stone-50 text-sm text-stone-500">
            <tr>
              <th className="p-4">대상자 정보</th>
              <th>위험 단계</th>
              <th>위험 점수</th>
              <th>최근 알림 응답</th>
              <th>마지막 가전 활동</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {sortedSubjects.map((subject) => (
              <tr
                className={subject.riskLevel === "DANGER" ? "bg-red-50" : "hover:bg-stone-50"}
                key={subject.subjectId}
              >
                <td className="p-4">
                  <strong>{subject.name} · {subject.age}세</strong>
                  <small className="block text-stone-500">{subject.address}</small>
                </td>
                <td>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ring-1 ${riskBadgeClass(subject.riskLevel)}`}>
                    {riskLabels[subject.riskLevel]}
                  </span>
                </td>
                <td className="font-bold">{subject.riskScore}점</td>
                <td>{responseLabel(subject.latestAlert?.subjectResponse)}</td>
                <td>
                  {formatDateTime(subject.lastActivity?.occurredAt)}
                  <small className="block text-stone-500">{subject.lastActivity?.applianceType}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="border-t border-stone-100 p-4 text-sm text-stone-500">
        총 {subjects.length}명 표시
      </footer>
    </section>
  );
}
