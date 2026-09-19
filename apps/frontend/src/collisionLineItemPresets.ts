export type CollisionPresetItem = {
  category: string;
  operation: string;
  description: string;
  laborHours?: number;
  paintHours?: number;
  unitPrice?: number;
};

export const COLLISION_LINE_ITEM_PRESETS: CollisionPresetItem[] = [
  // Front bumper
  { category: "Front Bumper", operation: "Rpr", description: "Front bumper cover - repair", laborHours: 1.5, paintHours: 2 },
  { category: "Front Bumper", operation: "Repl", description: "Front bumper cover - replace", laborHours: 1.2, paintHours: 2.5 },
  { category: "Front Bumper", operation: "R&I", description: "Front bumper cover - remove/install" },
  { category: "Front Bumper", operation: "Repl", description: "Front bumper absorber - replace" },
  { category: "Front Bumper", operation: "Repl", description: "Front bumper reinforcement - replace" },
  { category: "Front Bumper", operation: "Repl", description: "Front grille - replace" },
  { category: "Front Bumper", operation: "Repl", description: "Front license plate bracket - replace" },
  // Rear bumper
  { category: "Rear Bumper", operation: "Rpr", description: "Rear bumper cover - repair", laborHours: 1.5, paintHours: 2 },
  { category: "Rear Bumper", operation: "Repl", description: "Rear bumper cover - replace", laborHours: 1.2, paintHours: 2.5 },
  { category: "Rear Bumper", operation: "R&I", description: "Rear bumper cover - remove/install" },
  { category: "Rear Bumper", operation: "Repl", description: "Rear bumper absorber - replace" },
  { category: "Rear Bumper", operation: "Repl", description: "Rear bumper reinforcement - replace" },
  // Hood
  { category: "Hood", operation: "Rpr", description: "Hood - repair", laborHours: 2, paintHours: 2.5 },
  { category: "Hood", operation: "Repl", description: "Hood - replace", laborHours: 1.5, paintHours: 3 },
  { category: "Hood", operation: "R&I", description: "Hood - remove/install" },
  { category: "Hood", operation: "Repl", description: "Hood hinge - replace" },
  { category: "Hood", operation: "Repl", description: "Hood latch - replace" },
  // Fenders
  { category: "Fenders", operation: "Rpr", description: "Front fender (left) - repair", laborHours: 1.8, paintHours: 2 },
  { category: "Fenders", operation: "Rpr", description: "Front fender (right) - repair", laborHours: 1.8, paintHours: 2 },
  { category: "Fenders", operation: "Repl", description: "Front fender (left) - replace", laborHours: 1.3, paintHours: 2.5 },
  { category: "Fenders", operation: "Repl", description: "Front fender (right) - replace", laborHours: 1.3, paintHours: 2.5 },
  { category: "Fenders", operation: "Repl", description: "Fender liner (left) - replace" },
  { category: "Fenders", operation: "Repl", description: "Fender liner (right) - replace" },
  // Lighting
  { category: "Lighting", operation: "Repl", description: "Headlight assembly (left) - replace" },
  { category: "Lighting", operation: "Repl", description: "Headlight assembly (right) - replace" },
  { category: "Lighting", operation: "Repl", description: "Taillight assembly (left) - replace" },
  { category: "Lighting", operation: "Repl", description: "Taillight assembly (right) - replace" },
  { category: "Lighting", operation: "Repl", description: "Fog light (left) - replace" },
  { category: "Lighting", operation: "Repl", description: "Fog light (right) - replace" },
  // Doors
  { category: "Doors", operation: "Rpr", description: "Front door (left) - repair", laborHours: 2.5, paintHours: 2.5 },
  { category: "Doors", operation: "Rpr", description: "Front door (right) - repair", laborHours: 2.5, paintHours: 2.5 },
  { category: "Doors", operation: "Rpr", description: "Rear door (left) - repair", laborHours: 2.2, paintHours: 2.2 },
  { category: "Doors", operation: "Rpr", description: "Rear door (right) - repair", laborHours: 2.2, paintHours: 2.2 },
  { category: "Doors", operation: "Repl", description: "Front door shell (left) - replace", laborHours: 3, paintHours: 3 },
  { category: "Doors", operation: "Repl", description: "Front door shell (right) - replace", laborHours: 3, paintHours: 3 },
  { category: "Doors", operation: "Blnd", description: "Door blend panel", paintHours: 1 },
  { category: "Doors", operation: "Repl", description: "Door handle (exterior) - replace" },
  { category: "Doors", operation: "Repl", description: "Door mirror (left) - replace" },
  { category: "Doors", operation: "Repl", description: "Door mirror (right) - replace" },
  { category: "Doors", operation: "Repl", description: "Door glass - replace" },
  { category: "Doors", operation: "Repl", description: "Door weatherstrip - replace" },
  // Quarter panels / rear
  { category: "Quarter Panels", operation: "Rpr", description: "Quarter panel (left) - repair", laborHours: 3, paintHours: 3 },
  { category: "Quarter Panels", operation: "Rpr", description: "Quarter panel (right) - repair", laborHours: 3, paintHours: 3 },
  { category: "Quarter Panels", operation: "Repl", description: "Quarter panel (left) - replace", laborHours: 6, paintHours: 3.5 },
  { category: "Quarter Panels", operation: "Repl", description: "Quarter panel (right) - replace", laborHours: 6, paintHours: 3.5 },
  { category: "Quarter Panels", operation: "Blnd", description: "Quarter panel blend", paintHours: 1.2 },
  // Trunk / hatch / roof
  { category: "Trunk & Roof", operation: "Rpr", description: "Trunk lid - repair", laborHours: 1.8, paintHours: 2.2 },
  { category: "Trunk & Roof", operation: "Repl", description: "Trunk lid - replace", laborHours: 1.4, paintHours: 2.6 },
  { category: "Trunk & Roof", operation: "Repl", description: "Liftgate/hatch - replace", laborHours: 1.6, paintHours: 2.6 },
  { category: "Trunk & Roof", operation: "Rpr", description: "Roof panel - repair", laborHours: 3.5, paintHours: 3.5 },
  { category: "Trunk & Roof", operation: "Repl", description: "Rear spoiler - replace" },
  // Glass
  { category: "Glass", operation: "Repl", description: "Windshield - replace", laborHours: 1.5 },
  { category: "Glass", operation: "Repl", description: "Rear window - replace", laborHours: 1.2 },
  { category: "Glass", operation: "Repl", description: "Side mirror glass - replace" },
  // Frame / structural
  { category: "Frame & Structural", operation: "Rpr", description: "Frame rail (left) - straighten", laborHours: 4 },
  { category: "Frame & Structural", operation: "Rpr", description: "Frame rail (right) - straighten", laborHours: 4 },
  { category: "Frame & Structural", operation: "Rpr", description: "Radiator support - repair", laborHours: 2 },
  { category: "Frame & Structural", operation: "Repl", description: "Radiator support - replace", laborHours: 2.5 },
  { category: "Frame & Structural", operation: "Diag", description: "Frame measuring / diagnostic scan", laborHours: 1 },
  // Mechanical / cooling / suspension
  { category: "Mechanical", operation: "Repl", description: "Radiator - replace", laborHours: 1.5 },
  { category: "Mechanical", operation: "Repl", description: "AC condenser - replace", laborHours: 1.5 },
  { category: "Mechanical", operation: "Repl", description: "Suspension strut (left) - replace", laborHours: 1.2 },
  { category: "Mechanical", operation: "Repl", description: "Suspension strut (right) - replace", laborHours: 1.2 },
  { category: "Mechanical", operation: "Repl", description: "Control arm - replace", laborHours: 1.4 },
  { category: "Mechanical", operation: "Align", description: "Wheel alignment", laborHours: 1 },
  { category: "Mechanical", operation: "Repl", description: "Wheel/rim - replace" },
  { category: "Mechanical", operation: "Repl", description: "Tire - replace" },
  // Airbags / safety
  { category: "Safety Systems", operation: "Repl", description: "Airbag module - replace", laborHours: 1.5 },
  { category: "Safety Systems", operation: "Repl", description: "Seat belt pretensioner - replace", laborHours: 1 },
  { category: "Safety Systems", operation: "Calib", description: "ADAS camera calibration", laborHours: 1.5 },
  { category: "Safety Systems", operation: "Calib", description: "Radar sensor calibration", laborHours: 1.5 },
  // Paint & refinish
  { category: "Paint & Refinish", operation: "Refn", description: "Overall vehicle refinish" },
  { category: "Paint & Refinish", operation: "Refn", description: "Panel refinish - single panel", paintHours: 2 },
  { category: "Paint & Refinish", operation: "Blnd", description: "Adjacent panel blend", paintHours: 1 },
  { category: "Paint & Refinish", operation: "Clear", description: "Clear coat application", paintHours: 1 },
  // Shop / misc
  { category: "Shop & Misc", operation: "Misc", description: "Hazardous waste disposal fee" },
  { category: "Shop & Misc", operation: "Misc", description: "Shop supplies" },
  { category: "Shop & Misc", operation: "Misc", description: "Vehicle wash / detail" },
  { category: "Shop & Misc", operation: "Misc", description: "Rental car reimbursement" },
  { category: "Shop & Misc", operation: "Misc", description: "Towing fee" },
  { category: "Shop & Misc", operation: "Diag", description: "Pre-repair diagnostic scan" },
  { category: "Shop & Misc", operation: "Diag", description: "Post-repair diagnostic scan" },
];

export const COLLISION_LINE_ITEM_CATEGORIES = Array.from(
  new Set(COLLISION_LINE_ITEM_PRESETS.map((item) => item.category)),
);
