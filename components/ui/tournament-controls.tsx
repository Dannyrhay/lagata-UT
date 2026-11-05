import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

// Owned shadcn-style primitives; tournament styles provide Lagata's theme tokens.
const variants = cva("tournament-button", { variants: { variant: { default: "tournament-button-primary", outline: "tournament-button-outline" } }, defaultVariants: { variant: "default" } });
export function Button({ variant, className, type = "button", ...props }: ComponentProps<"button"> & VariantProps<typeof variants>) { return <button type={type} className={clsx(variants({ variant }), className)} {...props} />; }
export function Input({ className, ...props }: ComponentProps<"input">) { return <input className={clsx("tournament-input", className)} {...props} />; }
