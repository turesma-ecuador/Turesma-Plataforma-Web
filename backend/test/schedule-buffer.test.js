const test = require("node:test");
const assert = require("node:assert/strict");
const { scheduleConflictWithBuffer } = require("../dist/config/schedule");

test("aplica el margen operativo entre servicios", () => {
  const existing = {
    startDate: "2026-10-21",
    startTime: "15:00",
    endDate: "2026-10-21",
    endTime: "16:00",
  };

  assert.equal(scheduleConflictWithBuffer({
    startDate: "2026-10-21",
    startTime: "13:30",
    endDate: "2026-10-21",
    endTime: "14:30",
  }, existing), true);

  assert.equal(scheduleConflictWithBuffer({
    startDate: "2026-10-21",
    startTime: "12:00",
    endDate: "2026-10-21",
    endTime: "13:00",
  }, existing), false);
});

test("incluye traslado estimado cuando existen coordenadas", () => {
  assert.equal(scheduleConflictWithBuffer({
    startDate: "2026-10-21",
    startTime: "09:00",
    endDate: "2026-10-21",
    endTime: "10:00",
    destinationLat: 0,
    destinationLng: 0,
  }, {
    startDate: "2026-10-21",
    startTime: "11:00",
    endDate: "2026-10-21",
    endTime: "12:00",
    originLat: 1,
    originLng: 1,
  }), true);
});
