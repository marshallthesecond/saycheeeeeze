import { Button } from "@/src/components/ui/button"


export default function RegularButton(ButtonProps: React.ComponentProps<"button">) {
  return (
    <div className="flex flex-wrap items-center gap-2 md:flex-row">
        <Button className="w-[110] sm:w-[210]" variant="outline" size="xlg" aria-label="Choose" {...ButtonProps}>
          {ButtonProps.children}
          {/* Get Inspired */}
        </Button>
    </div>
  );
}

