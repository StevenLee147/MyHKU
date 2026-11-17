import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { X } from 'lucide-react'
import { CATEGORY_LABELS, type CustomTask, type CustomTaskCategory } from '../services/customTasks'
import type { LiveCourse } from '../services/hku'

function defaultDueLocal(): string {
  const d = new Date(Date.now() + 86_400_000)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return `${parts}T23:59`
}

function toDatetimeLocalValue(raw?: string): string {
  if (!raw) return defaultDueLocal()
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/)
  if (m) return `${m[1]}T${m[2]}`
  const dOnly = raw.trim().match(/^(\d{4}-\d{2}-\d{2})$/)
  if (dOnly) return `${dOnly[1]}T23:59`
  return defaultDueLocal()
}

export function CustomTaskModal({
  open,
  editingTask,
  courses,
  defaultCourse,
  onClose,
  onSave,
}: {
  open: boolean
  editingTask?: CustomTask | null
  courses: LiveCourse[]
  defaultCourse?: string
  onClose: () => void
  onSave: (input: {
    id?: string
    title: string
    course: string
    category: CustomTaskCategory
    due: string
    note?: string
  }) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const baseId = useId()
  const titleHeadingId = `${baseId}-heading`
  const titleInputId = `${baseId}-title`
  const titleErrId = `${baseId}-title-err`
  const courseInputId = `${baseId}-course`
  const courseListId = `${baseId}-courses`
  const catInputId = `${baseId}-cat`
  const dueInputId = `${baseId}-due`
  const dueErrId = `${baseId}-due-err`
  const noteInputId = `${baseId}-note`

  const [title, setTitle] = useState('')
  const [course, setCourse] = useState('')
  const [category, setCategory] = useState<CustomTaskCategory>('assignment')
  const [dueLocal, setDueLocal] = useState(defaultDueLocal)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    if (editingTask) {
      setTitle(editingTask.title)
      setCourse(editingTask.course === '个人自建' ? '' : editingTask.course)
      setCategory(editingTask.category)
      setDueLocal(toDatetimeLocalValue(editingTask.due))
      setNote(editingTask.note || '')
    } else {
      setTitle('')
      setCourse(defaultCourse || '')
      setCategory('assignment')
      setDueLocal(defaultDueLocal())
      setNote('')
    }
  }, [open, editingTask, defaultCourse])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const handleBackdropFallbackClick = (event: MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    const inside =
      rect.top <= event.clientY &&
      event.clientY <= rect.top + rect.height &&
      rect.left <= event.clientX &&
      event.clientX <= rect.left + rect.width
    if (!inside) dialog.close()
  }

  const handleNoteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      event.currentTarget.form?.requestSubmit()
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    const cleanDue = dueLocal.trim().replace('T', ' ')
    if (!cleanTitle || !cleanDue) return
    onSave({
      ...(editingTask ? { id: editingTask.id } : {}),
      title: cleanTitle,
      course: course.trim() || '个人自建',
      category,
      due: cleanDue,
      note: note.trim() || undefined,
    })
    dialogRef.current?.close()
  }

  return (
    <dialog
      ref={dialogRef}
      className="myhku-modal"
      aria-labelledby={titleHeadingId}
      onClick={handleBackdropFallbackClick}
      onClose={() => {
        if (dialogRef.current) dialogRef.current.returnValue = ''
        onClose()
      }}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <div className="modal-head">
        <h2 id={titleHeadingId}>{editingTask ? '编辑自建事项 / 倒计时' : '新建待办 / 考试倒计时'}</h2>
        <button
          type="button"
          className="icon-close-btn"
          aria-label="关闭弹窗"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={16} />
        </button>
      </div>
      <form className="modal-form" onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor={titleInputId}>事项名称 *</label>
          <input
            id={titleInputId}
            type="text"
            required
            autoFocus
            maxLength={160}
            placeholder="例如：GLIS1905 Final Exam / Group Presentation"
            value={title}
            onChange={e => setTitle(e.target.value)}
          />
          <div id={titleErrId} className="field-error-msg">
            <span role="img" aria-label="Error">!</span> 请填写事项名称。
          </div>
        </div>

        <div className="form-row-two">
          <div className="form-field">
            <label htmlFor={catInputId}>事项分类</label>
            <select
              id={catInputId}
              value={category}
              onChange={e => setCategory(e.target.value as CustomTaskCategory)}
            >
              {(Object.keys(CATEGORY_LABELS) as CustomTaskCategory[]).map(key => (
                <option key={key} value={key}>
                  {CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label htmlFor={courseInputId}>关联课程（可选）</label>
            <input
              id={courseInputId}
              type="text"
              list={courseListId}
              maxLength={120}
              placeholder="例如：GLIS1905 或留空"
              value={course}
              onChange={e => setCourse(e.target.value)}
            />
            <datalist id={courseListId}>
              {courses.map(c => (
                <option key={c.id} value={c.code || c.title}>
                  {c.title}
                </option>
              ))}
            </datalist>
          </div>
        </div>

        <div className="form-field">
          <label htmlFor={dueInputId}>截止 / 考试时间（香港时间 HKT）*</label>
          <input
            id={dueInputId}
            type="datetime-local"
            required
            value={dueLocal}
            onChange={e => setDueLocal(e.target.value)}
          />
          <div id={dueErrId} className="field-error-msg">
            <span role="img" aria-label="Error">!</span> 请选择有效的日期与时间。
          </div>
        </div>

        <div className="form-field">
          <label htmlFor={noteInputId}>备注 / 考场信息（Enter 保存，Shift+Enter 换行）</label>
          <textarea
            id={noteInputId}
            rows={2}
            maxLength={240}
            placeholder="例如：CPD-LG.18 闭卷考试 / 需带学生证"
            value={note}
            onChange={e => setNote(e.target.value)}
            onKeyDown={handleNoteKeyDown}
          />
        </div>

        <div className="modal-actions">
          <button type="button" className="outline-btn" onClick={() => dialogRef.current?.close()}>
            取消
          </button>
          <button type="submit" className="primary-btn">
            {editingTask ? '保存修改' : '添加事项'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
