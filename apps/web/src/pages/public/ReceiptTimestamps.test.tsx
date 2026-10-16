import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReceiptTimestamps } from "./ReceiptTimestamps";

afterEach(cleanup);
it('labels recorded order, payment and completion times with the approved strategy', () => {
  const { container } = render(<ReceiptTimestamps createdAt='2026-10-16T00:00:00Z'
    paidAt='2026-10-16T00:01:00Z' completedAt='2026-10-16T00:10:00Z' paid />);
  expect(screen.getByText('Timezone: Asia/Manila · en-PH')).toBeInTheDocument();
  expect(screen.getByText('Order placed')).toBeInTheDocument();
  expect(screen.getByText('Payment recorded')).toBeInTheDocument();
  expect(screen.getByText('Completion time')).toBeInTheDocument();
  expect([...container.querySelectorAll('time')].map((time) => time.dateTime))
    .toEqual(['2026-10-16T00:00:00Z', '2026-10-16T00:01:00Z', '2026-10-16T00:10:00Z']);
});
it('does not invent payment/completion times for an unpaid order', () => {
  render(<ReceiptTimestamps paid={false} />);
  expect(screen.getByText('Unavailable in this saved receipt')).toBeInTheDocument();
  expect(screen.queryByText('Payment recorded')).not.toBeInTheDocument();
  expect(screen.queryByText('Completion time')).not.toBeInTheDocument();
});
