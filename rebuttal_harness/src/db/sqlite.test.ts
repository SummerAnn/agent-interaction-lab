import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(() => ""),
}));

vi.mock("child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import { insertRow } from "./sqlite";

describe("SQLite writes", () => {
  beforeEach(() => {
    execFileSyncMock.mockClear();
  });

  it("passes SQL as an sqlite3 argument instead of an open stdin stream", () => {
    insertRow("/tmp/trace.db", "events", {
      run_id: "run-1",
      step: 3,
    });

    expect(execFileSyncMock).toHaveBeenCalledOnce();
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "/usr/bin/sqlite3",
      [
        "/tmp/trace.db",
        'INSERT INTO "events" ("run_id", "step") VALUES (\'run-1\', 3);',
      ],
      { encoding: "utf8" },
    );
    expect(execFileSyncMock.mock.calls[0]?.[2]).not.toHaveProperty("input");
  });
});
