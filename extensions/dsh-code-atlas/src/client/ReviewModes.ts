import type { ReviewIntent } from '../core/types.js';

export const reviewModes: readonly { id: ReviewIntent; label: string; action: string; prompt: string; hint: string }[] = [
  { id: 'change-review', label: '变更核验', action: '核验变更', prompt: '检查两次扫描之间的改动：哪些行为可能受影响、还有哪些调用方或测试需要核对？请区分源码事实与待验证项。', hint: '修改代码后再次扫描，先检查改动范围。' },
  { id: 'flow', label: '运行流程', action: '梳理流程', prompt: '解释当前入口的输入、关键处理、状态变化、失败路径和结果；缺少实现时请明确说明。', hint: '从一个入口或一项用户任务开始。' },
  { id: 'design', label: '设计取舍', action: '讨论设计', prompt: '评估当前代码的职责边界和变化点，比较保持简单、小范围抽取与采用设计模式的方案，说明依据、代价和验证办法。', hint: '先问哪里难改，再判断模式是否值得引入。' },
  { id: 'refactor', label: '重构计划', action: '制定计划', prompt: '为当前代码提出小步重构计划：列出要保持的行为、每一步修改范围、先补哪些验证以及如何回退。只给建议，不执行修改。', hint: '把一次大改拆成可以逐步核验的步骤。' },
];
export const modeInfo = (intent: ReviewIntent) => reviewModes.find(mode => mode.id === intent) ?? reviewModes[1]!;
