/**
 * 任务队列
 * - 串行处理总结任务，避免并发冲突
 * - 同一楼层的小总结任务去重
 */

export type TaskType = 'mini_summary' | 'volume_summary';

export type SummaryTask = {
  type: TaskType;
  message_id?: number;
};

type TaskHandler = {
  mini_summary: (message_id: number) => Promise<void>;
  volume_summary: () => Promise<void>;
};

export class TaskQueue {
  private queue: SummaryTask[] = [];
  private processing = false;
  private handlers: TaskHandler | null = null;

  /** 注册任务处理函数 */
  setHandlers(handlers: TaskHandler): void {
    this.handlers = handlers;
  }

  /** 将任务加入队列 */
  enqueue(task: SummaryTask): void {
    // 去重：同一楼层的小总结任务只保留最新的
    if (task.type === 'mini_summary' && task.message_id !== undefined) {
      this.queue = this.queue.filter(
        t => !(t.type === 'mini_summary' && t.message_id === task.message_id)
      );
    }
    this.queue.push(task);
    void this.processNext();
  }

  /** 依次处理队列中的任务 */
  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    try {
      const task = this.queue.shift()!;
      if (!this.handlers) {
        console.error('[自动总结] 任务处理函数未注册');
        return;
      }

      if (task.type === 'mini_summary' && task.message_id !== undefined) {
        await this.handlers.mini_summary(task.message_id);
      } else if (task.type === 'volume_summary') {
        await this.handlers.volume_summary();
      }
    } catch (e) {
      console.error('[自动总结] 总结任务执行失败:', e);
    } finally {
      this.processing = false;
      if (this.queue.length > 0) {
        await this.processNext();
      }
    }
  }
}

/** 全局任务队列实例 */
export const taskQueue = new TaskQueue();
