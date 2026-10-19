import { ListSkeleton } from "../../components/feedback/LoadingSkeleton";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { FiGrid, FiPlus } from "react-icons/fi";
import {
  TABLE_LIMITS,
  TABLE_NUMBER_PATTERN,
  normalizeTableNumber,
  compareTableNumbers,
  hasShopPermission,
  type ApiErrorResponse,
  type CurrentUserResponse,
  type TablesResponse,
} from "@paserve/contracts";
import { useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  createTable,
  listTables,
  tablesKey,
} from "../../features/shops/api/tables";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";
import "./tables.css";
import { TableQrDialog } from "./TableQrDialog";

export function TablesPage() {
  const membership = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return (
    <TableWorkspace key={`${userId}:${membership.shopId}`} userId={userId} />
  );
}

function TableWorkspace({ userId }: { userId: string }) {
  const membership = useActiveShop();
  const { shopId } = membership;
  const client = useQueryClient();
  const key = tablesKey(userId, shopId);
  const authorized = hasShopPermission(
    membership.role,
    "shop.operations.manage",
  );
  const [number, setNumber] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState("");
  const [lostAccess, setLostAccess] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [qrTableId, setQrTableId] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stillHere = () =>
    mounted.current &&
    client.getQueryData<CurrentUserResponse>(currentUserKey)?.user.id ===
      userId;
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listTables(shopId, signal),
    enabled: authorized && !lostAccess,
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
  });
  const mutation = useMutation({
    mutationFn: (value: string) => createTable(shopId, { number: value }),
    retry: false,
    networkMode: "always",
  });
  const denied =
    isAxiosError(query.error) &&
    [401, 403, 404].includes(query.error.response?.status ?? 0);
  const qrTable = query.isSuccess
    ? query.data.tables.find((table) => table.id === qrTableId)
    : undefined;

  async function refresh() {
    const result = await query.refetch();
    if (stillHere() && result.isSuccess) {
      setUncertain(false);
      setError("");
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      busy.current ||
      !authorized ||
      lostAccess ||
      uncertain ||
      denied ||
      !query.isSuccess ||
      query.isFetching
    )
      return;
    const value = normalizeTableNumber(number);
    if (
      !value ||
      !TABLE_NUMBER_PATTERN.test(value) ||
      [...value].length > TABLE_LIMITS.numberMaxLength
    ) {
      setFieldError(
        `Enter a table number or label of 1–${TABLE_LIMITS.numberMaxLength} characters without control characters.`,
      );
      input.current?.focus();
      return;
    }
    busy.current = true;
    setError("");
    setFieldError("");
    try {
      const result = await mutation.mutateAsync(value);
      if (!stillHere()) return;
      client.setQueryData<TablesResponse>(key, (current) => ({
        tables: [
          ...(current?.tables ?? []).filter(
            (table) => table.id !== result.table.id,
          ),
          result.table,
        ].sort(compareTableNumbers),
      }));
      void client.invalidateQueries({ queryKey: key });
      setNumber("");
      feedback.toast(`Table ${result.table.number} was created.`);
    } catch (failure) {
      if (!stillHere()) return;
      if (isAxiosError<ApiErrorResponse>(failure)) {
        const status = failure.response?.status;
        if ([401, 403, 404].includes(status ?? 0)) {
          setLostAccess(true);
          setError(
            "Your access changed. Refresh the shop workspace to continue.",
          );
        } else if (failure.response?.data.code === "TABLE_CODE_UNAVAILABLE") {
          setError("We couldn’t allocate a table code. Please try again.");
        } else if (status === 409) {
          setFieldError(
            "This table number or label already exists. Choose a different label.",
          );
          void client.invalidateQueries({ queryKey: key });
        } else if (failure.response?.data.fieldErrors?.number) {
          setFieldError(failure.response.data.fieldErrors.number[0]);
        } else if (!failure.response || (status ?? 0) >= 500) {
          setUncertain(true);
          setError(
            "We couldn’t confirm creation. Refresh tables before trying again.",
          );
        } else setError("We couldn’t create this table. Please try again.");
      } else {
        setUncertain(true);
        setError(
          "We couldn’t confirm creation. Refresh tables before trying again.",
        );
      }
    } finally {
      busy.current = false;
    }
  }
  useEffect(() => {
    if (fieldError && !mutation.isPending) input.current?.focus();
  }, [fieldError, mutation.isPending]);
  if (!authorized)
    return (
      <section className="dashboard-status">
        <h1>Tables</h1>
        <InlineMessage>
          Only this shop’s owner or admin can manage tables.
        </InlineMessage>
      </section>
    );
  const disabled =
    mutation.isPending ||
    lostAccess ||
    denied ||
    uncertain ||
    !query.isSuccess ||
    query.isFetching;
  return (
    <section className="tables-page" aria-labelledby="tables-title">
      <header className="tables-heading">
        <p className="section-label">YOUR RESTAURANT</p>
        <h1 id="tables-title">Tables</h1>
        <p>Create and view tables for {membership.shop.name}.</p>
      </header>
      <div className="tables-layout">
        <section className="tables-panel" aria-labelledby="saved-tables-title">
          <h2 id="saved-tables-title">
            <FiGrid aria-hidden="true" /> Saved tables
          </h2>
          {query.isPending && <ListSkeleton label="Loading tables…" tables />}
          {query.isError && (
            <InlineMessage>
              {denied
                ? "Your access changed. Refresh the shop workspace to continue."
                : "We couldn’t load tables. Please try again."}
            </InlineMessage>
          )}
          {(query.isError || uncertain) && !denied && !lostAccess && (
            <button
              className="secondary-button"
              disabled={query.isFetching || mutation.isPending}
              onClick={() => void refresh()}
            >
              {query.isFetching ? "Refreshing…" : "Refresh tables"}
            </button>
          )}
          {query.isSuccess &&
            !lostAccess &&
            (query.data.tables.length ? (
              <ul className="tables-list">
                {query.data.tables.map((table) => (
                  <li key={table.id}>
                    <div>
                      <strong>Table {table.number}</strong>
                      <span>Code: {table.code}</span>
                    </div>
                    <span className="table-status">
                      {table.isActive ? "Active" : "Inactive"}
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!table.isActive || disabled}
                      onClick={() => setQrTableId(table.id)}
                      aria-label={`Generate QR for Table ${table.number}`}
                    >
                      Generate QR
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="tables-empty">
                No tables yet. Create your first table to get started.
              </p>
            ))}
        </section>
        <section
          className="tables-panel tables-create"
          aria-labelledby="create-table-title"
        >
          <h2 id="create-table-title">Create table</h2>
          <p>Enter the number or label displayed on the table.</p>
          <form onSubmit={(event) => void submit(event)} noValidate>
            <div className="field">
              <label htmlFor="table-number">Table number</label>
              <input
                id="table-number"
                ref={input}
                type="text"
                autoComplete="off"
                maxLength={TABLE_LIMITS.numberMaxLength * 2}
                placeholder="12, A3, Patio 4"
                value={number}
                disabled={disabled}
                aria-invalid={!!fieldError}
                aria-describedby={`table-number-hint${fieldError ? " table-number-error" : ""}`}
                onChange={(event) => {
                  setNumber(event.target.value);
                  setFieldError("");
                  setError("");
                }}
              />
              <p className="field-hint" id="table-number-hint">
                Use up to 40 characters, such as 12, A3 or Patio 4. Labels are
                unique in this shop, ignoring case.
              </p>
              {fieldError && (
                <InlineMessage id="table-number-error">
                  {fieldError}
                </InlineMessage>
              )}
            </div>
            {error && <InlineMessage>{error}</InlineMessage>}
            <button
              className="primary-button"
              disabled={disabled}
              type="submit"
            >
              <FiPlus aria-hidden="true" />
              {mutation.isPending ? "Creating…" : "Create table"}
            </button>
          </form>
        </section>
      </div>
      {qrTable && !lostAccess && !denied && authorized && (
        <TableQrDialog
          key={`${qrTable.id}:${qrTable.code}`}
          table={qrTable}
          shop={membership.shop}
          onClose={() => setQrTableId(null)}
        />
      )}
    </section>
  );
}
