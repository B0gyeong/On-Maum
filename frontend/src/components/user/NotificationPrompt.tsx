type NotificationPromptProps = {
  disabled: boolean;
  onAnswer: (answer: "yes" | "no") => void;
};

export default function NotificationPrompt({ disabled, onAnswer }: NotificationPromptProps) {
  return (
    <section
      className="min-w-0 rounded-3xl border border-stone-200 bg-white p-6 shadow-[0_2px_10px_rgb(15_23_42_/_3%)] max-[359px]:p-5"
      aria-labelledby="response-title"
    >
      <h2 className="text-2xl font-bold" id="response-title">
        지금 상태를 알려주세요
      </h2>
      <p className="mt-2 text-lg text-stone-600">선택한 응답을 담당자에게 전달해요.</p>
      <div className="mt-6 grid gap-3">
        <button
          className="flex min-h-16 w-full items-center justify-center rounded-2xl border border-[#9b312c] bg-[#b33b35] px-4 py-3.5 text-center text-[1.3125rem] leading-6 font-semibold text-white shadow-[0_4px_0_#7e2925,0_7px_14px_rgb(126_41_37_/_14%)] transition-[transform,box-shadow,background-color] duration-150 hover:not-disabled:bg-[#96312c] active:not-disabled:translate-y-[3px] active:not-disabled:shadow-[0_1px_0_#7e2925,0_3px_6px_rgb(126_41_37_/_8%)] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
          disabled={disabled}
          onClick={() => onAnswer("yes")}
        >
          도움이 필요해요
        </button>
        <button
          className="flex min-h-16 w-full items-center justify-center rounded-2xl border border-stone-300 bg-white px-4 py-3.5 text-center text-[1.3125rem] leading-6 font-semibold text-stone-800 shadow-[0_4px_0_#d6d3d1,0_7px_14px_rgb(15_23_42_/_6%)] transition-[transform,box-shadow,background-color] duration-150 hover:not-disabled:bg-stone-50 active:not-disabled:translate-y-[3px] active:not-disabled:shadow-[0_1px_0_#d6d3d1,0_3px_6px_rgb(15_23_42_/_6%)] disabled:cursor-not-allowed disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-600 disabled:shadow-none"
          disabled={disabled}
          onClick={() => onAnswer("no")}
        >
          괜찮아요
        </button>
      </div>
    </section>
  );
}
