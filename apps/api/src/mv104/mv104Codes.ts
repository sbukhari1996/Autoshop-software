// Code legends for NY DMV form MV-104 (5/25), transcribed from the form's page 2 instructions.
// Option values must match the PDF dropdown option strings exactly (verified against the form).

export interface Mv104Code {
  value: string;
  label: string;
}

const code = (value: string, label: string): Mv104Code => ({ value, label });

export const mv104Codes = {
  trafficControl: [
    code('1.', 'None'), code('2.', 'Traffic signal'), code('3.', 'Stop sign'), code('4.', 'Flashing light'),
    code('5.', 'Yield sign'), code('6.', 'Officer/Guard'), code('7.', 'No passing zone'), code('8.', 'RR crossing sign'),
    code('9.', 'RR crossing flashing light'), code('10.', 'RR crossing gates'), code('11.', 'Stopped school bus - red lights flashing'),
    code('15.', 'Police/Fire emergency'), code('16.', 'School zone'), code('17.', 'All way stop sign'), code('18.', 'Roundabout'),
    code('19.', 'Warning sign'), code('20.', 'Other'), code('21.', 'HOV lane'), code('22.', 'Bike lane'), code('23.', 'Bus lane'),
    code('-', 'Does not apply'), code('X', 'Unknown'),
  ],
  roadwaySurface: [
    code('1.', 'Dry'), code('2.', 'Wet'), code('3.', 'Muddy'), code('4.', 'Snow'), code('5.', 'Slush'),
    code('6.', 'Flooded'), code('7.', 'Ice'), code('0.', 'Other'), code('-', 'Does not apply'), code('X', 'Unknown'),
  ],
  direction: [
    code('1.', 'North'), code('2.', 'Northeast'), code('3.', 'East'), code('4.', 'Southeast'), code('5.', 'South'),
    code('6.', 'Southwest'), code('7.', 'West'), code('8.', 'Northwest'), code('-', 'Does not apply'), code('X', 'Unknown'),
  ],
  preCrash: [
    code('1.', 'Going straight ahead'), code('2.', 'Making right turn'), code('3.', 'Making left turn'),
    code('4.', 'Making U-turn'), code('5.', 'Entering/exiting parked position'), code('6.', 'Starting in traffic'),
    code('7.', 'Slowing or stopping'), code('8.', 'Stopped in traffic'), code('10.', 'Parked'),
    code('11.', 'Avoiding object in roadway'), code('12.', 'Changing lanes'), code('13.', 'Passing'), code('14.', 'Merging'),
    code('15.', 'Backing'), code('19.', 'Traveling wrong way'), code('20.', 'Other'), code('21.', 'Crossed over median'),
    code('22.', 'Avoiding double parked/stopped vehicle'), code('23.', 'Avoid vehicle door'), code('24.', 'Negotiating a curve'),
    code('-', 'Does not apply'), code('X', 'Unknown'),
  ],
  typeOfCrash: [
    code('1.', 'Other motor vehicle'), code('2.', 'Pedestrian'), code('3.', 'Bicyclist'), code('4.', 'Animal'),
    code('5.', 'Railroad train'), code('7.', 'Deer'), code('10.', 'Other object (not fixed)'), code('11.', 'Light support/utility pole'),
    code('12.', 'Guide rail/median - not at end'), code('13.', 'Impact attenuator/crash cushion'), code('14.', 'Sign post'),
    code('15.', 'Tree'), code('16.', 'Building/Wall'), code('17.', 'Curbing'), code('18.', 'Fence'), code('19.', 'Bridge structure'),
    code('20.', 'Culvert/Head wall'), code('22.', 'Snow embankment'), code('23.', 'Earth embankment/rock cut/ditch'),
    code('24.', 'Fire hydrant'), code('25.', 'Guide rail/median - end'), code('27.', 'Barrier'), code('30.', 'Other object (fixed)'),
    code('31.', 'Overturned'), code('32.', 'Fire/Explosion'), code('33.', 'Submersion'), code('34.', 'Ran off roadway only'),
    code('36.', 'Mailbox'), code('37.', 'Pothole'), code('38.', 'Thrown or falling object'), code('40.', 'Other'),
    code('41.', 'Slow moving vehicle'), code('42.', 'Animal drawn conveyance'), code('43.', 'Snowmobile/ATV/UTV/Dirtbike'),
    code('44.', 'Struck by falling, shifting cargo or anything set in motion by motor vehicle'),
    code('45.', 'Struck by object not set in motion by motor vehicle'), code('46.', 'Pedestrian on a non-motorized device'),
    code('47.', 'Pedestrian on a motorized device'), code('-', 'Does not apply'), code('X', 'Unknown'),
  ],
  unit: [code('1.', 'Your vehicle/unit'), code('2.', 'Other vehicle/unit')],
  position: [
    code('1.', 'Driver'), code('2.', 'Passenger'), code('3.', 'Passenger'), code('4.', 'Passenger'), code('5.', 'Passenger'),
    code('6.', 'Passenger'), code('7.', 'Cargo area/all bus passengers'), code('8.', 'Riding/hanging on outside'),
    code('9.', 'Seat position unknown inside vehicle'), code('10.', 'Passenger'), code('11.', 'Passenger'), code('12.', 'Passenger'),
  ],
  safety: [
    code('1.', 'None'), code('2.', 'Lap belt only'), code('3.', 'Shoulder belt only'), code('4.', 'Shoulder and lap belt'),
    code('6.', 'Motorcycle helmet - DOT compliant'), code('17.', 'Child booster seat'),
    code('18.', 'Child restraint system - forward facing'), code('19.', 'Child restraint system - rear facing'),
    code('20.', 'Stretcher'), code('21.', 'Wheelchair'), code('22.', 'Motorcycle helmet - other'),
    code('23.', 'Front/rear bicycle lights, helmet'), code('24.', 'Front/rear bicycle lights, no helmet'),
    code('25.', 'Reflectors'), code('26.', 'Reflective clothing'), code('0.', 'Other'),
    code('C.', 'Helmet only (non-motorcycle)'), code('X.', 'Unknown'), code('(-).', 'Not applicable'),
  ],
  injury: [
    code('A.', 'Severe: lacerations, broken/distorted limbs, skull fracture, crushed chest, internal injuries'),
    code('B.', 'Minor: lump on head, abrasions, minor injuries'),
    code('C.', 'Complaint: momentary unconsciousness, limping, nausea, complaint of pain (no visible injury)'),
  ],
  diagram: [
    code('0', 'Left turn'), code('1', 'Rear end'), code('2', 'Sideswipe (same direction)'), code('3', 'Left turn'),
    code('4', 'Right angle'), code('5', 'Right turn'), code('6', 'Right turn'), code('7', 'Head on'),
    code('8', 'Sideswipe (opposite direction)'), code('9', 'Other / 3+ vehicles / pedestrian or bike'),
  ],
} as const;

export type Mv104CodeKey = keyof typeof mv104Codes;
