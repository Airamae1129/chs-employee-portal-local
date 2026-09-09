import Swal from "sweetalert2";

/**
 * Thin SweetAlert2 wrapper so every "it worked" / "it failed" / "are
 * you sure" moment in the app (clock in/out, uploads, deletes, saves)
 * looks and behaves the same, themed to the CHS palette instead of
 * SweetAlert2's defaults.
 */
const base = Swal.mixin({
  buttonsStyling: false,
  customClass: {
    confirmButton:
      "rounded-full bg-chs-gold px-5 py-2.5 text-sm font-semibold text-chs-charcoal hover:opacity-90 mx-1",
    cancelButton: "rounded-full bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-200 mx-1",
    denyButton: "rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600 mx-1",
    popup: "rounded-2xl",
  },
});

export function notifySuccess(title: string, text?: string) {
  return base.fire({ icon: "success", title, text, timer: 2200, showConfirmButton: false });
}

export function notifyError(title: string, text?: string) {
  return base.fire({ icon: "error", title, text, confirmButtonText: "OK" });
}

export function notifyInfo(title: string, text?: string) {
  return base.fire({ icon: "info", title, text, timer: 2600, showConfirmButton: false });
}

export async function confirmAction(opts: {
  title: string;
  text?: string;
  confirmText?: string;
  danger?: boolean;
}): Promise<boolean> {
  const result = await base.fire({
    icon: opts.danger ? "warning" : "question",
    title: opts.title,
    text: opts.text,
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? "Confirm",
    cancelButtonText: "Cancel",
    customClass: {
      confirmButton: opts.danger
        ? "rounded-full bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600 mx-1"
        : "rounded-full bg-chs-gold px-5 py-2.5 text-sm font-semibold text-chs-charcoal hover:opacity-90 mx-1",
      cancelButton: "rounded-full bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-200 mx-1",
      popup: "rounded-2xl",
    },
  });
  return result.isConfirmed;
}

export function toast(icon: "success" | "error" | "info", title: string) {
  return base.fire({
    toast: true,
    position: "top-end",
    icon,
    title,
    showConfirmButton: false,
    timer: 2500,
    timerProgressBar: true,
  });
}
