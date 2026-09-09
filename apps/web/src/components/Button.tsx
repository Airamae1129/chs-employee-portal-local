import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "destructive" | "success" | "ghost";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-chs-gold text-chs-charcoal hover:opacity-90 shadow-sm hover:shadow-md",
  secondary: "bg-gray-100 text-gray-700 hover:bg-gray-200",
  destructive: "bg-red-50 text-red-600 hover:bg-red-100",
  success: "bg-green-50 text-green-700 hover:bg-green-100",
  ghost: "text-gray-500 hover:bg-gray-100",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  icon,
  children,
  ...props
}: {
  variant?: Variant;
  size?: Size;
  icon?: React.ReactNode;
  children: React.ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
