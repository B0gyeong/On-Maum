import Icon from "../common/Icon";

export type UserTab = "home" | "away";

type UserNavigationProps = {
  tab: UserTab;
  onChange: (tab: UserTab) => void;
};

export default function UserNavigation({ tab, onChange }: UserNavigationProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-xl gap-3 border-t border-stone-200 bg-white px-5 pt-3 pb-[calc(.75rem+env(safe-area-inset-bottom))]"
      aria-label="대상자 메뉴"
    >
      <button
        className={`flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl text-xl font-semibold transition-colors ${tab === "home" ? "bg-brand-600 text-white shadow-sm" : "text-stone-600"}`}
        aria-current={tab === "home" ? "page" : undefined}
        onClick={() => onChange("home")}
      >
        <Icon name="home" />홈
      </button>
      <button
        className={`flex min-h-16 flex-1 items-center justify-center gap-2 rounded-xl text-xl font-semibold transition-colors ${tab === "away" ? "bg-brand-600 text-white shadow-sm" : "text-stone-600"}`}
        aria-current={tab === "away" ? "page" : undefined}
        onClick={() => onChange("away")}
      >
        <Icon name="walk" />
        외출
      </button>
    </nav>
  );
}
