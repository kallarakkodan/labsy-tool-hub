import { describe, expect, it } from "vitest";
import { fileIconKind } from "../src/lib/icons";

/** PRD §7.3's mapping, using the seeded artifact names where they exist. */
describe("fileIconKind", () => {
  it("maps disc images", () => {
    expect(fileIconKind("ubuntu-22.04.4-live-server-amd64.iso")).toBe("disc");
    expect(fileIconKind("ventoy-1.0.99-multiboot.img")).toBe("disc");
  });

  it("maps Windows installers", () => {
    expect(fileIconKind("labsy-deployer-3.1.0.exe")).toBe("app");
    expect(fileIconKind("node-v22.11.0-offline-installer.msi")).toBe("app");
  });

  it("maps archives, including compound extensions", () => {
    expect(fileIconKind("intel-network-drivers-28.3.zip")).toBe("archive");
    // Must not fall through a naive lastIndexOf(".") to .gz and miss the pair.
    expect(fileIconKind("bundle.tar.gz")).toBe("archive");
    expect(fileIconKind("bundle.tar.xz")).toBe("archive");
  });

  it("maps packages and scripts", () => {
    expect(fileIconKind("agent_1.2.0_amd64.deb")).toBe("package");
    expect(fileIconKind("agent-1.2.0.rpm")).toBe("package");
    expect(fileIconKind("provision.sh")).toBe("script");
    expect(fileIconKind("provision.ps1")).toBe("script");
  });

  it("falls back for unknown and extensionless names", () => {
    expect(fileIconKind("mystery.qcow2")).toBe("file");
    expect(fileIconKind("README")).toBe("file");
  });

  it("ignores case, since names arrive however the vendor shipped them", () => {
    expect(fileIconKind("WINDOWS-11.ISO")).toBe("disc");
  });
});
