import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Sprout, BrainCircuit, History, Settings, Leaf } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { farmer } from "@/data/mock-farm";

const items = [
  { title: "Dashboard", to: "/", icon: LayoutDashboard },
  { title: "My Farm", to: "/farm", icon: Sprout },
  { title: "AI Decisions", to: "/ai-decisions", icon: BrainCircuit },
  { title: "Decision History", to: "/history", icon: History },
  { title: "Settings", to: "/settings", icon: Settings },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border/60 px-3 py-4">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Leaf className="size-5" />
          </span>
          <span className="min-w-0 group-data-[collapsible=icon]:hidden">
            <span className="block truncate font-display text-sm font-bold tracking-tight">
              KRISHI-NEXUS
            </span>
            <span className="block truncate text-[11px] text-sidebar-foreground/60">
              Agricultural decision support
            </span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Control room</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild isActive={pathname === item.to} tooltip={item.title}>
                    <Link to={item.to}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/60 group-data-[collapsible=icon]:hidden">
        <div className="rounded-xl bg-sidebar-accent px-3 py-2.5 text-sidebar-accent-foreground">
          <p className="truncate text-sm font-semibold">{farmer.name}</p>
          <p className="truncate text-[11px] opacity-70">
            {farmer.village}, {farmer.district}
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
