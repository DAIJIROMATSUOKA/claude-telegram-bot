import { expect, test } from "bun:test";
import { greet } from "./greet";

test("greet('World') returns 'Hello, World!'", () => {
  expect(greet("World")).toBe("Hello, World!");
});

test("greet('DJ') returns 'Hello, DJ!'", () => {
  expect(greet("DJ")).toBe("Hello, DJ!");
});
