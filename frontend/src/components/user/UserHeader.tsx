import Brand from "../common/Brand";

export default function UserHeader({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="mx-auto flex max-w-xl items-center justify-between gap-3 px-5 py-5 max-[359px]:flex-wrap">
      <Brand />
      <button
        className="min-h-12 rounded-xl px-3 py-2 text-lg font-medium text-stone-600 transition-colors hover:bg-stone-100"
        onClick={onLogout}
      >
        로그아웃
      </button>
    </header>
  );
}
