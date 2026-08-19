/**
 * mergeCustomerAccounts consolidates shell/anonymous customer rows into a
 * verified target. Supabase is fully mocked: we assert the query patterns
 * (per-table select/update/delete) rather than talking to a real database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Track every table interaction so tests can assert on the merge sequence.
type Op = { table: string; op: string; args: unknown[] };
let ops: Op[] = [];

function makeChain(table: string, dataFor: (op: string) => unknown) {
  const state: { op: string; args: unknown[] } = { op: "?", args: [] };
  const chain: any = {
    select: (...a: unknown[]) => {
      state.op = "select";
      state.args = a;
      return chain;
    },
    update: (...a: unknown[]) => {
      state.op = "update";
      state.args = a;
      return chain;
    },
    delete: (...a: unknown[]) => {
      state.op = "delete";
      state.args = a;
      return chain;
    },
    eq: () => chain,
    neq: () => chain,
    ilike: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const value = dataFor(state.op);
      ops.push({ table, op: state.op, args: state.args });
      return { data: value, error: null };
    },
    then: (resolve: (v: { data: unknown; error: null }) => void) => {
      const value = dataFor(state.op);
      ops.push({ table, op: state.op, args: state.args });
      resolve({ data: value, error: null });
    },
  };
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => {
  return {
    getSupabaseAdmin: () => ({
      from(table: string) {
        return makeChain(table, (op) => {
          if (table === "customers" && op === "select") {
            // First call resolves the target; second call lists shells.
            const previousTargetLookups = ops.filter(
              (o) => o.table === "customers" && o.op === "select",
            ).length;
            if (previousTargetLookups === 0) {
              return {
                id: "target-1",
                merchant_id: "m1",
                name: null,
                phone: null,
                address: null,
                city: null,
                country: null,
                language: null,
                notes: null,
                tags: ["vip"],
                profile_structured: null,
                total_orders: 2,
                total_spent: 100,
                last_order_at: "2024-01-01",
              };
            }
            return [
              {
                id: "shell-1",
                name: "Alice",
                phone: "010",
                address: "Cairo",
                city: "Cairo",
                country: "EG",
                language: "ar",
                notes: null,
                tags: ["returning"],
                profile_structured: { communication_style: { tone: "warm" } },
                profile_summary: "warm",
                profile_updated_at: "2024-06-01",
                profile_message_count: 4,
                total_orders: 1,
                total_spent: 50,
                last_order_at: "2024-06-01",
              },
              {
                id: "shell-2",
                name: null,
                phone: null,
                address: null,
                city: null,
                country: null,
                language: null,
                notes: "shell 2",
                tags: [],
                profile_structured: null,
                total_orders: 3,
                total_spent: 75,
                last_order_at: "2024-05-01",
              },
            ];
          }
          return null;
        });
      },
    }),
  };
});

// Import AFTER the mock is registered.
import {
  validateMergeInput,
  runMergeCustomerAccounts,
} from "@/lib/customer-merge.functions";

beforeEach(() => {
  ops = [];
});

describe("validateMergeInput", () => {
  it("throws when a required field is missing", () => {
    expect(() =>
      validateMergeInput({ merchant_id: "", email: "x@y.z", target_customer_id: "t" }),
    ).toThrow(/required/);
  });

  it("lowercases and trims the email", () => {
    const v = validateMergeInput({
      merchant_id: "m1",
      email: "  Foo@Example.COM ",
      target_customer_id: "t",
    });
    expect(v.email).toBe("foo@example.com");
  });
});

describe("runMergeCustomerAccounts", () => {
  it("consolidates shells: fills empty target fields, aggregates totals, reassigns owned rows, and cleans up", async () => {
    const res = await runMergeCustomerAccounts({
      merchant_id: "m1",
      email: "foo@example.com",
      target_customer_id: "target-1",
    });

    expect(res).toEqual({ merged: 2, target_customer_id: "target-1" });

    const patch = ops.find((o) => o.table === "customers" && o.op === "update");
    expect(patch).toBeTruthy();
    const patchArg = patch!.args[0] as Record<string, unknown>;
    expect(patchArg).toMatchObject({
      email: "foo@example.com",
      email_verified: true,
      total_orders: 6,
      total_spent: 225,
      last_order_at: "2024-06-01",
      name: "Alice",
      phone: "010",
      address: "Cairo",
    });
    expect(new Set(patchArg.tags as string[])).toEqual(new Set(["vip", "returning"]));
    expect(patchArg.profile_structured).toEqual({ communication_style: { tone: "warm" } });
    expect(patchArg.profile_message_count).toBe(4);

    for (const t of ["conversations", "orders", "complaints"]) {
      expect(
        ops.some((o) => o.table === t && o.op === "update"),
        `${t} should be reassigned via update`,
      ).toBe(true);
    }

    expect(ops.some((o) => o.table === "customers" && o.op === "delete")).toBe(true);
  });
});
