"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { type ChevronProps, DayPicker } from "react-day-picker";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CalendarProps = ComponentProps<typeof DayPicker>;

// Module-level so its identity is stable: a component created inside Calendar's
// render would be a new type each time and remount on every render.
function CalendarChevron({ orientation }: ChevronProps) {
  if (orientation === "left") return <ChevronLeft className="h-4 w-4" />;
  if (orientation === "right") return <ChevronRight className="h-4 w-4" />;
  return (
    <ChevronRight className="h-3 w-3 ml-1 opacity-50 transition-transform duration-200 group-focus-within:rotate-90" />
  );
}

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3 relative", className)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        month_caption: "flex justify-center pt-1 items-center px-8",
        caption_label: "text-sm font-medium inline-flex items-center whitespace-nowrap",
        dropdowns: "flex items-center gap-1 flex-nowrap",
        dropdown_root:
          "relative inline-flex items-center rounded-md border border-input bg-background px-1.5 py-0.5 text-sm group",
        dropdown: "absolute inset-0 w-full cursor-pointer opacity-0",
        nav: "absolute top-3 right-3 left-3 flex items-center justify-between z-10 pointer-events-none",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 pointer-events-auto",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 pointer-events-auto",
        ),
        month_grid: "w-full border-collapse space-y-1",
        weekdays: "flex",
        weekday: "text-muted-foreground rounded-md w-9 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-primary/10 [&:has([aria-selected].day-range-end)]:rounded-r-md [&:has([aria-selected].day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 p-0 font-normal aria-selected:opacity-100",
        ),
        range_start:
          "day-range-start [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground [&>button]:focus:bg-primary [&>button]:focus:text-primary-foreground",
        range_end:
          "day-range-end [&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground [&>button]:focus:bg-primary [&>button]:focus:text-primary-foreground",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground [&>button]:focus:bg-primary [&>button]:focus:text-primary-foreground",
        today: "bg-accent text-accent-foreground",
        outside:
          "day-outside text-muted-foreground aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "bg-primary/10 [&>button]:bg-transparent [&>button]:!text-black dark:[&>button]:!text-white [&>button]:hover:!bg-black [&>button]:hover:!text-white dark:[&>button]:hover:!bg-white dark:[&>button]:hover:!text-black",
        hidden: "invisible",
        ...classNames,
      }}
      components={{ Chevron: CalendarChevron }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export type { CalendarProps };
export { Calendar };
