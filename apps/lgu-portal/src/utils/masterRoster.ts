import type { DriverRecord } from '../mockData/adminData';
import type { MasterRosterEntryRow } from '../services/adminApiService';

/** The franchise number as a person would compare it: "mtop-1234", "MTOP 1234" and "MTOP1234" are the same number */
export const franchiseKey = (value?: string | null): string => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export type RosterMatch = 'matched' | 'rosterOnly' | 'driverOnly' | 'left';

export interface RosterRow {
  key: string;
  name: string;
  franchise: string;
  plate: string;
  membershipNo: string;
  entry?: MasterRosterEntryRow;
  driver?: DriverRecord;
  match: RosterMatch;
}

/**
 * One row per roster member and per registered driver of a TODA, so the LGU can compare what the TODA says with who applied. A member and a driver with the same franchise number
 * are one row ('matched'); a member with no driver account is 'rosterOnly'; a driver the roster does not name is 'driverOnly' (every driver counts: verified or not, endorsed or not);
 * a member who left is 'left' (history). A driver whose franchise number belongs to a member who left, with no active member of it, is shown with that member, not twice.
 */
export function buildRosterRows(entries: MasterRosterEntryRow[], drivers: DriverRecord[]): RosterRow[] {
  const driverByKey = new Map<string, DriverRecord>();
  for (const d of drivers) {
    const k = franchiseKey(d.franchiseNo);
    if (k && !driverByKey.has(k)) driverByKey.set(k, d);
  }
  const usedDrivers = new Set<string>();
  const activeKeys = new Set(entries.filter((e) => e.status === 'Active').map((e) => franchiseKey(e.franchiseNumber)));
  const rows: RosterRow[] = [];

  for (const e of entries) {
    const k = franchiseKey(e.franchiseNumber);
    const driver = k ? driverByKey.get(k) : undefined;
    if (e.status === 'Left') {
      rows.push({ key: `entry-${e.entryId}`, name: e.memberName, franchise: e.franchiseNumber, plate: e.plateNumber, membershipNo: e.membershipNumber, entry: e, driver: driver && !activeKeys.has(k) ? driver : undefined, match: 'left' });
      continue;
    }
    if (driver) usedDrivers.add(driver.id);
    rows.push({
      key: `entry-${e.entryId}`,
      name: driver?.name || e.memberName,
      franchise: e.franchiseNumber,
      plate: e.plateNumber || driver?.vehiclePlate || '',
      membershipNo: e.membershipNumber,
      entry: e,
      driver,
      match: driver ? 'matched' : 'rosterOnly',
    });
  }

  const leftDriverIds = new Set(rows.filter((r) => r.match === 'left' && r.driver).map((r) => r.driver!.id));
  for (const d of drivers) {
    if (usedDrivers.has(d.id) || leftDriverIds.has(d.id)) continue;
    rows.push({ key: `driver-${d.id}`, name: d.name, franchise: d.franchiseNo, plate: d.vehiclePlate, membershipNo: d.affiliations?.[0]?.membershipNo || '', driver: d, match: 'driverOnly' });
  }
  return rows;
}
