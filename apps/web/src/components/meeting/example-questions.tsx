import { Lightbulb } from 'lucide-react';
import React from 'react';

export interface ExampleQuestion {
  text: string;
  /** 该示例问题所属项目的名称片段（用于自动切换项目）。 */
  projectHint?: string;
}

/** 与演示数据（星河笔记 / 云仓物流）匹配的示例问题。 */
export const EXAMPLE_QUESTIONS: ExampleQuestion[] = [
  {
    text: '星河笔记 v1.0 的检索方案最后怎么定的？',
    projectHint: '星河笔记',
  },
  {
    text: '谁负责检索方案的技术验证？',
    projectHint: '星河笔记',
  },
  {
    text: '华东仓的出库口调整为哪个门？为什么调整？',
    projectHint: '云仓物流',
  },
];

export interface ExampleQuestionsProps {
  onPick: (question: string) => void;
  className?: string;
}

/** 空状态里的示例问题按钮：点击后填入输入框。 */
export function ExampleQuestions({
  onPick,
  className,
}: ExampleQuestionsProps): JSX.Element {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <p className="flex items-center gap-1.5 text-xs text-zinc-400">
        <Lightbulb className="h-3.5 w-3.5 text-accent-base" aria-hidden />
        试试这些问题（点击填入输入框）
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLE_QUESTIONS.map((item) => (
          <li key={item.text}>
            <button
              type="button"
              onClick={() => onPick(item.text)}
              title="点击填入输入框"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2 text-left text-xs text-zinc-200 transition-colors hover:border-accent-base/60 hover:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-accent-base"
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ExampleQuestions;
