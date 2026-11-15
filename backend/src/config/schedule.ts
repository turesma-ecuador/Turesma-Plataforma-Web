type ScheduleSlot = {
  id?: number;
  startDate?: string | Date | null;
  startTime?: string | null;
  endDate?: string | Date | null;
  endTime?: string | null;
  originLat?: number | string | null;
  originLng?: number | string | null;
  destinationLat?: number | string | null;
  destinationLng?: number | string | null;
};

const dateOnly = (value: string | Date | null | undefined) => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value || "").slice(0, 10);
};

const timeOnly = (value: string | null | undefined) => String(value || "").slice(0, 5);

const timestamp = (date: string, time: string) => {
  const parsed = Date.parse(`${date}T${time}:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

const validCoordinate = (value: number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roadTransferMinutes = (from: ScheduleSlot, to: ScheduleSlot) => {
  const lat1 = validCoordinate(from.destinationLat);
  const lng1 = validCoordinate(from.destinationLng);
  const lat2 = validCoordinate(to.originLat);
  const lng2 = validCoordinate(to.originLng);
  if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) return 0;

  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = toRadians(lat2 - lat1);
  const lngDelta = toRadians(lng2 - lng1);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(lngDelta / 2) ** 2;
  const straightLineKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.ceil(straightLineKm * 1.4 / 40 * 60);
};

const slotTimestamps = (slot: ScheduleSlot) => {
  const startDate = dateOnly(slot.startDate);
  const endDate = dateOnly(slot.endDate) || startDate;
  const startTime = timeOnly(slot.startTime);
  const endTime = timeOnly(slot.endTime);
  if (!startDate || !endDate || !startTime || !endTime) return null;
  const start = timestamp(startDate, startTime);
  const end = timestamp(endDate, endTime);
  return start !== null && end !== null && end > start ? { start, end } : null;
};

const scheduleConflictWithBuffer = (candidate: ScheduleSlot, existing: ScheduleSlot, bufferMinutes = 60) => {
  const candidateRange = slotTimestamps(candidate);
  const existingRange = slotTimestamps(existing);
  if (!candidateRange || !existingRange) {
    const candidateStart = dateOnly(candidate.startDate);
    const candidateEnd = dateOnly(candidate.endDate) || candidateStart;
    const existingStart = dateOnly(existing.startDate);
    const existingEnd = dateOnly(existing.endDate) || existingStart;
    return Boolean(candidateStart && existingStart && candidateStart <= existingEnd && existingStart <= candidateEnd);
  }

  if (candidateRange.start < existingRange.end && existingRange.start < candidateRange.end) return true;
  const bufferMs = bufferMinutes * 60_000;
  if (candidateRange.end <= existingRange.start) {
    return candidateRange.end + bufferMs + roadTransferMinutes(candidate, existing) * 60_000 > existingRange.start;
  }
  return existingRange.end + bufferMs + roadTransferMinutes(existing, candidate) * 60_000 > candidateRange.start;
};

module.exports = { scheduleConflictWithBuffer };
