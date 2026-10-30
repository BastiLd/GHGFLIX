// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Scrubber } from "./Scrubber";
afterEach(cleanup);
it("previews a drag without restarting the stream until release", () => {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  const seek = vi.fn();
  const { getByRole } = render(<Scrubber position={10} duration={120} onSeek={seek} getThumb={async () => null} />);
  const bar = getByRole("slider");
  bar.getBoundingClientRect = () => ({ left: 0, width: 120 } as DOMRect);
  fireEvent.pointerDown(bar, { clientX: 20, button: 0 });
  fireEvent.pointerMove(window, { clientX: 60 });
  expect(seek).not.toHaveBeenCalled();
  fireEvent.pointerUp(window, { clientX: 90 });
  expect(seek).toHaveBeenCalledExactlyOnceWith(90);
});
it("supports remote keyboard seeking and clamps to the media duration", () => {
  const seek = vi.fn();
  const { getByRole } = render(<Scrubber position={115} duration={120} onSeek={seek} getThumb={async () => null} />);
  fireEvent.keyDown(getByRole("slider"), { key: "ArrowRight" });
  expect(seek).toHaveBeenCalledWith(120);
});
it("does not seek for an unknown duration or cancelled gesture", () => {
  const seek = vi.fn();
  const { getByRole } = render(<Scrubber position={0} duration={0} onSeek={seek} getThumb={async () => null} />);
  fireEvent.pointerDown(getByRole("slider"), { button: 0 });
  fireEvent.keyDown(getByRole("slider"), { key: "ArrowRight" });
  expect(seek).not.toHaveBeenCalled();
});
