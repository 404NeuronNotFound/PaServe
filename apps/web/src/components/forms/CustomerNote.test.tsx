import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CustomerNote } from "./CustomerNote";

afterEach(cleanup);

it.each([
  '<img src=x onerror="alert(1)">',
  '<script>alert("test")</script>',
  '[open](javascript:alert(1))',
  'Less ice\nNo onions & extra cheese',
])("renders notes as literal text: %s", (notes) => {
  const { container } = render(<CustomerNote notes={notes} />);
  expect(container.textContent).toBe(notes);
  expect(container.querySelector("img, script, a")).toBeNull();
});

it.each([undefined, "", " \n "])("omits an empty note %s", (notes) => {
  const { container } = render(<CustomerNote notes={notes} />);
  expect(container).toBeEmptyDOMElement();
});
