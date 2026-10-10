import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlist } from "../../src/apple/plist";
import { authenticate } from "../../src/apple/authenticate";
import { appleRequest } from "../../src/apple/request";
import { fetchBag } from "../../src/apple/bag";

vi.mock("../../src/apple/request", () => ({
  appleRequest: vi.fn(),
}));

vi.mock("../../src/apple/bag", () => ({
  fetchBag: vi.fn(),
  defaultAuthURL:
    "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate",
}));

describe("apple/authenticate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets guid query exactly once from bag endpoint", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL:
        "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate?foo=1&guid=old-value",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: {},
      rawHeaders: [],
      body: buildPlist({
        accountInfo: {
          appleId: "test@example.com",
          address: {
            firstName: "Test",
            lastName: "User",
          },
        },
        passwordToken: "token",
        dsPersonId: "123",
      }),
    });

    await authenticate(
      "test@example.com",
      "password",
      undefined,
      undefined,
      "aabbccddeeff",
    );

    const requestCall = vi.mocked(appleRequest).mock.calls[0][0];
    const endpoint = new URL(`https://${requestCall.host}${requestCall.path}`);

    expect(endpoint.searchParams.get("guid")).toBe("aabbccddeeff");
    expect(endpoint.searchParams.getAll("guid")).toHaveLength(1);
    expect(endpoint.searchParams.get("foo")).toBe("1");
  });

  it("treats HTTP 204 after 2FA code as verification success and fetches account info", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL:
        "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate",
    });

    // First call (with 2FA code) returns 204 empty - 2FA verified
    // Second call (follow-up) returns account info
    vi.mocked(appleRequest)
      .mockResolvedValueOnce({
        status: 204,
        statusText: "No Content",
        headers: {},
        rawHeaders: ["set-cookie: session=abc123"],
        body: "",
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        rawHeaders: [],
        body: buildPlist({
          accountInfo: {
            appleId: "test@example.com",
            address: {
              firstName: "Test",
              lastName: "User",
            },
          },
          passwordToken: "token",
          dsPersonId: "123",
        }),
      });

    const account = await authenticate(
      "test@example.com",
      "password",
      "123456",
      undefined,
      "aabbccddeeff",
    );

    // Should have made 2 requests: 2FA verify (204) + account info fetch
    expect(vi.mocked(appleRequest)).toHaveBeenCalledTimes(2);

    // First request should have attempt="2" with code appended to password
    const firstCall = vi.mocked(appleRequest).mock.calls[0][0];
    expect(firstCall.body).toContain("password123456");

    // Second request should have attempt="4" without code (follow-up)
    const secondCall = vi.mocked(appleRequest).mock.calls[1][0];
    expect(secondCall.body).not.toContain("123456");

    // Should return the account successfully
    expect(account.appleId).toBe("test@example.com");
    expect(account.passwordToken).toBe("token");
  });

  it("still throws emptyBody error for non-204 empty responses", async () => {
    vi.mocked(fetchBag).mockResolvedValue({
      authURL:
        "https://buy.itunes.apple.com/WebObjects/MZFinance.woa/wa/authenticate",
    });
    vi.mocked(appleRequest).mockResolvedValue({
      status: 403,
      statusText: "Forbidden",
      headers: {},
      rawHeaders: [],
      body: "",
    });

    await expect(
      authenticate("test@example.com", "password", undefined, undefined, "aabbccddeeff"),
    ).rejects.toThrow();
  });
});
