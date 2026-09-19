import React from "react";
import {
  COLLISION_LINE_ITEM_CATEGORIES,
  COLLISION_LINE_ITEM_PRESETS,
  type CollisionPresetItem,
} from "./collisionLineItemPresets";

export function LineItemPresetPicker({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (items: CollisionPresetItem[]) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("All");
  const [selected, setSelected] = React.useState<Set<number>>(new Set());

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setCategory("All");
      setSelected(new Set());
    }
  }, [open]);

  if (!open) return null;

  const filtered = COLLISION_LINE_ITEM_PRESETS.filter((item, index) => {
    const matchesCategory = category === "All" || item.category === category;
    const matchesQuery = `${item.category} ${item.operation} ${item.description}`
      .toLowerCase()
      .includes(query.toLowerCase());
    return matchesCategory && matchesQuery && index >= 0;
  });

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function addSelected() {
    const items = COLLISION_LINE_ITEM_PRESETS.filter((_, index) =>
      selected.has(index),
    );
    if (items.length) onAdd(items);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal preset-picker-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Collision line item library</p>
            <h2>Select repair items</h2>
          </div>
          <button type="button" className="close-button" onClick={onClose}>
            x
          </button>
        </div>
        <div className="preset-picker-controls">
          <input
            className="preset-picker-search"
            placeholder="Search line items..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="All">All categories</option>
            {COLLISION_LINE_ITEM_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div className="preset-picker-list">
          {filtered.length ? (
            filtered.map((item) => {
              const index = COLLISION_LINE_ITEM_PRESETS.indexOf(item);
              const checked = selected.has(index);
              return (
                <label
                  className={checked ? "preset-picker-item checked" : "preset-picker-item"}
                  key={index}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(index)}
                  />
                  <span className="preset-picker-item-body">
                    <strong>{item.description}</strong>
                    <small>
                      {item.category} · {item.operation}
                      {item.laborHours ? ` · ${item.laborHours}h labor` : ""}
                      {item.paintHours ? ` · ${item.paintHours}h paint` : ""}
                    </small>
                  </span>
                </label>
              );
            })
          ) : (
            <p className="records-muted">No line items match this search.</p>
          )}
        </div>
        <div className="preset-picker-footer">
          <span>{selected.size} selected</span>
          <div className="estimate-actions">
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="orange-button"
              onClick={addSelected}
              disabled={!selected.size}
            >
              Add {selected.size ? selected.size : ""} to list
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
