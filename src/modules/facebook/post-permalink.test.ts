import { describe, expect, it, vi } from "vitest";
import {
  facebookPostObjectUrl,
  resolveFacebookPostUrl,
} from "./post-permalink";

describe("Facebook post permalink resolver", () => {
  it("builds an object URL from a composite Graph post ID", () => {
    expect(
      facebookPostObjectUrl("641287252408644_122191998680910216").href,
    ).toBe("https://www.facebook.com/641287252408644_122191998680910216");
  });

  it("uses Facebook's canonical redirect when it is safe", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 301,
        headers: {
          location:
            "https://www.facebook.com/permalink.php?story_fbid=pfbid-test&id=61577306485952",
        },
      }),
    );

    const result = await resolveFacebookPostUrl(
      "641287252408644_122191998680910216",
      request,
    );

    expect(result.href).toBe(
      "https://www.facebook.com/permalink.php?story_fbid=pfbid-test&id=61577306485952",
    );
    expect(request).toHaveBeenCalledWith(
      new URL("https://www.facebook.com/641287252408644_122191998680910216"),
      expect.objectContaining({ method: "HEAD", redirect: "manual" }),
    );
  });

  it("rejects a non-Facebook redirect and falls back to the object URL", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://example.com/not-facebook" },
      }),
    );

    const result = await resolveFacebookPostUrl(
      "641287252408644_122191998680910216",
      request,
    );

    expect(result.href).toBe(
      "https://www.facebook.com/641287252408644_122191998680910216",
    );
  });

  it("rejects malformed post IDs before making a request", async () => {
    await expect(resolveFacebookPostUrl("not-a-post-id")).rejects.toMatchObject(
      { code: "INVALID_FACEBOOK_POST_ID" },
    );
  });
});
