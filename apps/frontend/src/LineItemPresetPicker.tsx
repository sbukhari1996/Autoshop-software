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
  const [selectedSubItems, setSelectedSubItems] = React.useState<
    Map<number, Set<number>>
  >(new Map());

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setCategory("All");
      setSelected(new Set());
      setSelectedSubItems(new Map());
    }
  }, [open]);

  if (!open) return null;

  const filtered = COLLISION_LINE_ITEM_PRESETS.filter((item, index) => {
    const matchesCategory = category === "All" || item.category === category;
    const searchable = [
      item.category,
      item.operation,
      item.description,
      item.partNumber || "",
      ...(item.subItems || []).map((subItem) => subItem.description),
    ].join(" ");
    const matchesQuery = searchable
      .toLowerCase()
      .includes(query.toLowerCase());
    return matchesCategory && matchesQuery && index >= 0;
  });

  function toggle(index: number) {
    const removing = selected.has(index);
    setSelected((current) => {
      const next = new Set(current);
      if (removing) next.delete(index);
      else next.add(index);
      return next;
    });
    if (removing) {
      setSelectedSubItems((current) => {
        const next = new Map(current);
        next.delete(index);
        return next;
      });
    }
  }

  function toggleSubItem(parentIndex: number, subItemIndex: number) {
    setSelectedSubItems((current) => {
      const next = new Map(current);
      const selectedForParent = new Set(next.get(parentIndex) || []);
      if (selectedForParent.has(subItemIndex)) selectedForParent.delete(subItemIndex);
      else selectedForParent.add(subItemIndex);
      if (selectedForParent.size) next.set(parentIndex, selectedForParent);
      else next.delete(parentIndex);
      return next;
    });
  }

  function addSelected() {
    const items = COLLISION_LINE_ITEM_PRESETS.flatMap((item, index) =>
      selected.has(index)
        ? [{
            ...item,
            subItems: (item.subItems || []).filter((_, subItemIndex) =>
              selectedSubItems.get(index)?.has(subItemIndex),
            ),
          }]
        : [],
    );
    if (items.length) onAdd(items);
    onClose();
  }
  const selectedCount = selected.size + Array.from(selectedSubItems.values())
    .reduce((count, items) => count + items.size, 0);

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
        <p className="records-muted">
          Labor times can vary by vehicle, damage, and OEM procedure. Confirm hours from the vehicle-specific repair information before finalizing.
        </p>
        <div className="preset-picker-list">
          {filtered.length ? (
            filtered.map((item) => {
              const index = COLLISION_LINE_ITEM_PRESETS.indexOf(item);
              const checked = selected.has(index);
              return (
                <div className="preset-picker-group" key={index}>
                  <label
                    className={checked ? "preset-picker-item checked" : "preset-picker-item"}
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
                        {item.partNumber ? ` · Part ${item.partNumber}` : ""}
                        {item.unitPrice !== undefined ? ` · ${item.quantity || 1} × $${item.unitPrice.toFixed(2)}` : ""}
                        {item.laborHours ? ` · ${item.laborHours}h labor` : ""}
                        {item.paintHours ? ` · ${item.paintHours}h paint` : ""}
                      </small>
                    </span>
                  </label>
                  {checked && item.subItems?.length ? (
                    <div className="preset-subitem-list">
                      <strong>Optional sub-line items</strong>
                      {item.subItems.map((subItem, subItemIndex) => (
                        <label key={subItemIndex}>
                          <input
                            type="checkbox"
                            checked={selectedSubItems.get(index)?.has(subItemIndex) || false}
                            onChange={() => toggleSubItem(index, subItemIndex)}
                          />
                          <span>{subItem.description}</span>
                          <small>
                            {subItem.partNumber ? `Part ${subItem.partNumber} · ` : ""}
                            {subItem.unitPrice !== undefined ? `${subItem.quantity || 1} × $${subItem.unitPrice.toFixed(2)} · ` : ""}
                            {subItem.laborHours ? `${subItem.laborHours}h labor` : ""}
                            {subItem.paintHours ? `${subItem.laborHours ? " · " : ""}${subItem.paintHours}h paint` : ""}
                          </small>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="records-muted">No line items match this search.</p>
          )}
        </div>
        <div className="preset-picker-footer">
          <span>{selected.size} repair{selected.size === 1 ? "" : "s"} · {selectedCount - selected.size} sub-lines selected</span>
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
              Add {selectedCount ? selectedCount : ""} to list
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
