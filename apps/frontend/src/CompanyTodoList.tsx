import React from "react";

export type CompanyTodo = {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
};

type Request = <T>(path: string, options?: RequestInit) => Promise<T>;

export function CompanyTodoList({
  todos,
  request,
  onChanged,
}: {
  todos: CompanyTodo[];
  request: Request;
  onChanged: () => void;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingTodo, setEditingTodo] = React.useState<CompanyTodo | null>(null);
  const [title, setTitle] = React.useState("");
  const [dueDate, setDueDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const activeTodos = todos.filter((todo) => !todo.completed);
  const completedTodos = todos.filter((todo) => todo.completed);

  function openDialog(todo?: CompanyTodo) {
    setError("");
    setEditingTodo(todo || null);
    setTitle(todo?.title || "");
    setDueDate(todo ? todo.dueDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setDialogOpen(true);
  }

  async function saveTodo(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await request(editingTodo ? `/todos/${editingTodo.id}` : "/todos", {
        method: editingTodo ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueDate }),
      });
      setDialogOpen(false);
      setEditingTodo(null);
      onChanged();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save task");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTodo(todo: CompanyTodo) {
    setError("");
    try {
      await request(`/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !todo.completed }),
      });
      onChanged();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update task");
    }
  }

  async function deleteTodo(todo: CompanyTodo) {
    if (!window.confirm(`Delete "${todo.title}"? This cannot be undone.`)) return;
    setError("");
    try {
      await request(`/todos/${todo.id}`, { method: "DELETE" });
      onChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete task");
    }
  }

  function renderTodo(todo: CompanyTodo) {
    return (
      <div
        className={`company-todo-row${todo.completed ? " completed" : ""}`}
        key={todo.id}
      >
        <button
          type="button"
          className="company-todo-check"
          aria-label={todo.completed ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
          aria-pressed={todo.completed}
          onClick={() => void toggleTodo(todo)}
        >
          {todo.completed ? "✓" : ""}
        </button>
        <button
          type="button"
          className="company-todo-task"
          onClick={() => void toggleTodo(todo)}
          aria-label={`${todo.completed ? "Reopen" : "Complete"} task: ${todo.title}`}
        >
          <strong>{todo.title}</strong>
          <time dateTime={todo.dueDate.slice(0, 10)}>
            Due {new Date(`${todo.dueDate.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </time>
        </button>
        <button type="button" className="secondary-button company-todo-action" onClick={() => openDialog(todo)}>Edit</button>
        <button type="button" className="danger-button compact-danger company-todo-action" onClick={() => void deleteTodo(todo)}>Delete</button>
      </div>
    );
  }

  return (
    <>
      <div className="surface-heading company-todo-heading">
        <div>
          <h2>Company to-do list</h2>
          <p>{activeTodos.length} active task{activeTodos.length === 1 ? "" : "s"} · shared with your workspace</p>
        </div>
        <button type="button" className="orange-button" onClick={() => openDialog()}>Add task</button>
      </div>
      {error && <div className="error-banner company-todo-error">{error}</div>}
      <section className="company-todo-section" aria-labelledby="active-todo-heading">
        <h3 id="active-todo-heading">To do</h3>
        <div className="company-todo-list">
          {activeTodos.map(renderTodo)}
          {!activeTodos.length && <p className="company-todo-empty">No active tasks. Add a task to get started.</p>}
        </div>
      </section>
      <section className="company-todo-section company-completed-section" aria-labelledby="completed-todo-heading">
        <h3 id="completed-todo-heading">Completed <span>{completedTodos.length}</span></h3>
        <div className="company-todo-list company-completed-list">
          {completedTodos.map(renderTodo)}
          {!completedTodos.length && <p className="company-todo-empty">Completed tasks will appear here.</p>}
        </div>
      </section>
      {dialogOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setDialogOpen(false);
        }}>
          <form className="modal company-todo-modal" onSubmit={saveTodo}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Shared workspace task</p>
                <h2>{editingTodo ? "Edit task" : "Add task"}</h2>
              </div>
              <button type="button" className="close-button" onClick={() => setDialogOpen(false)} aria-label="Close task form">×</button>
            </div>
            <label>
              Task
              <input autoFocus required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="What needs to get done?" />
            </label>
            <label>
              Due date
              <input required type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
            </label>
            <div className="company-todo-form-actions">
              <button type="button" className="secondary-button" onClick={() => setDialogOpen(false)}>Cancel</button>
              <button className="orange-button" disabled={saving}>{saving ? "Saving..." : editingTodo ? "Save changes" : "Add task"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
