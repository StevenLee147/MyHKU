import type { LiveAssignment } from './hku'

export type CustomTaskCategory = 'assignment' | 'quiz' | 'exam' | 'project'

export type CustomTask = {
  id: string
  title: string
  course: string
  category: CustomTaskCategory
  due: string
  note?: string
  completed: boolean
  createdAt: string
}

export type UnifiedAssignment = LiveAssignment & {
  isCustom?: boolean
  category?: CustomTaskCategory
  note?: string
}

export const CUSTOM_TASKS_KEY = 'myhku-custom-tasks'

export const CATEGORY_LABELS: Record<CustomTaskCategory, string> = {
  assignment: '自建作业',
  quiz: '小测 Quiz',
  exam: '考试 Exam',
  project: '课程 Project',
}

function isValidCategory(value: unknown): value is CustomTaskCategory {
  return value === 'assignment' || value === 'quiz' || value === 'exam' || value === 'project'
}

export function getCustomTasks(): CustomTask[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_TASKS_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item, idx): CustomTask | null => {
        const title = typeof item.title === 'string' ? item.title.trim() : ''
        const due = typeof item.due === 'string' ? item.due.trim() : ''
        if (!title || !due) return null
        const course = typeof item.course === 'string' && item.course.trim() ? item.course.trim() : '个人自建'
        const category = isValidCategory(item.category) ? item.category : 'assignment'
        const note = typeof item.note === 'string' && item.note.trim() ? item.note.trim() : undefined
        return {
          id: typeof item.id === 'string' && item.id ? item.id : `custom-${idx}-${Date.now()}`,
          title,
          course,
          category,
          due,
          ...(note ? { note } : {}),
          completed: Boolean(item.completed),
          createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        }
      })
      .filter((item): item is CustomTask => item !== null)
  } catch {
    return []
  }
}

export function saveCustomTasks(items: CustomTask[]): CustomTask[] {
  try {
    localStorage.setItem(CUSTOM_TASKS_KEY, JSON.stringify(items))
  } catch {
    /* ignore quota errors */
  }
  return items
}

export function addCustomTask(input: {
  title: string
  course?: string
  category?: CustomTaskCategory
  due: string
  note?: string
}): CustomTask[] {
  const title = input.title.trim()
  const due = input.due.trim().replace('T', ' ')
  if (!title || !due) return getCustomTasks()
  const nextItem: CustomTask = {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: title.slice(0, 160),
    course: (input.course || '').trim().slice(0, 120) || '个人自建',
    category: isValidCategory(input.category) ? input.category : 'assignment',
    due: due.slice(0, 60),
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 240) } : {}),
    completed: false,
    createdAt: new Date().toISOString(),
  }
  return saveCustomTasks([nextItem, ...getCustomTasks()])
}

export function updateCustomTask(
  id: string,
  patch: Partial<Pick<CustomTask, 'title' | 'course' | 'category' | 'due' | 'note' | 'completed'>>,
): CustomTask[] {
  const next = getCustomTasks().map(item => {
    if (item.id !== id) return item
    const title = patch.title !== undefined ? patch.title.trim() : item.title
    const due = patch.due !== undefined ? patch.due.trim().replace('T', ' ') : item.due
    if (!title || !due) return item
    const course = patch.course !== undefined ? patch.course.trim() || '个人自建' : item.course
    const note = patch.note !== undefined ? patch.note.trim() || undefined : item.note
    return {
      ...item,
      title: title.slice(0, 160),
      course: course.slice(0, 120),
      category: patch.category && isValidCategory(patch.category) ? patch.category : item.category,
      due: due.slice(0, 60),
      note,
      completed: patch.completed !== undefined ? patch.completed : item.completed,
    }
  })
  return saveCustomTasks(next)
}

export function toggleCustomTask(id: string): CustomTask[] {
  const next = getCustomTasks().map(item => (item.id === id ? { ...item, completed: !item.completed } : item))
  return saveCustomTasks(next)
}

export function deleteCustomTask(id: string): CustomTask[] {
  return saveCustomTasks(getCustomTasks().filter(item => item.id !== id))
}

export function clearCustomTasks(): void {
  try {
    localStorage.removeItem(CUSTOM_TASKS_KEY)
  } catch {
    /* ignore */
  }
}

export function customTaskToUnified(task: CustomTask): UnifiedAssignment {
  const categoryLabel = CATEGORY_LABELS[task.category]
  return {
    id: task.id,
    title: task.title,
    course: task.course,
    due: task.due,
    completed: task.completed,
    submissionStatus: `${categoryLabel}${task.note ? ` · ${task.note}` : ''}`,
    isCustom: true,
    category: task.category,
    ...(task.note ? { note: task.note } : {}),
  }
}

export function mergeWithCustomTasks(moodleAssignments: LiveAssignment[], customTasks: CustomTask[]): UnifiedAssignment[] {
  return [
    ...moodleAssignments.map(item => ({ ...item, isCustom: false })),
    ...customTasks.map(customTaskToUnified),
  ]
}
