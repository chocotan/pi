import { type Component, HStack, ScrollView, type ScrollViewScrollbar, VStack } from "@earendil-works/pi-tui";

export type SidebarMode = "auto" | "hidden" | "panel";

export interface ChatViewportOptions {
	readonly document: Component;
	readonly pendingMessages: Component;
	readonly status: Component;
	readonly editor: Component;
	readonly footer: Component;
	readonly widgetsAbove?: Component;
	readonly widgetsBelow?: Component;
	readonly sidebar?: Component;
	readonly sidebarDivider?: Component;
	readonly sidebarMode?: () => SidebarMode;
	readonly hasSidebarWidgets?: () => boolean;
	readonly scrollbar?: ScrollViewScrollbar;
	readonly scrollbarTrackStyle?: (text: string) => string;
	readonly scrollbarThumbStyle?: (text: string) => string;
}

export interface ChatViewport {
	readonly root: Component;
	readonly transcript: ScrollView;
	readonly sidebar?: ScrollView;
}

/** Shared fullscreen transcript and fixed input-dock layout. */
export function createChatViewport(options: ChatViewportOptions): ChatViewport {
	const transcript = new ScrollView(options.document, {
		follow: "end",
		primary: true,
		overscroll: "chain",
		scrollbar: options.scrollbar ?? "auto",
		...(options.scrollbarTrackStyle === undefined ? {} : { scrollbarTrackStyle: options.scrollbarTrackStyle }),
		...(options.scrollbarThumbStyle === undefined ? {} : { scrollbarThumbStyle: options.scrollbarThumbStyle }),
	});
	const dock = new VStack([
		{ component: options.pendingMessages, shrink: 1, minSize: 0 },
		{ component: options.status, shrink: 1, minSize: 0 },
		...(options.widgetsAbove === undefined ? [] : [{ component: options.widgetsAbove, shrink: 1, minSize: 0 }]),
		{ component: options.editor, shrink: 1, minSize: 3 },
		...(options.widgetsBelow === undefined ? [] : [{ component: options.widgetsBelow, shrink: 1, minSize: 0 }]),
		{ component: options.footer, shrink: 1, minSize: 0 },
	]);
	const main = new VStack([
		{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
	]);
	if (!options.sidebar) return { transcript, root: main };
	const sidebar = new ScrollView(options.sidebar, { overscroll: "contain", scrollbar: "auto" });
	const mode = () => options.sidebarMode?.() ?? "auto";
	const visible = (viewport: { width: number }) =>
		mode() === "auto" && viewport.width >= 100 && (options.hasSidebarWidgets?.() ?? true);
	return {
		transcript,
		sidebar,
		root: new HStack([
			{ component: main, basis: 0, grow: 1, minSize: 1, visible: () => mode() !== "panel" },
			...(options.sidebarDivider ? [{ component: options.sidebarDivider, basis: 1, shrink: 0, visible }] : []),
			{ component: sidebar, basis: 30, grow: 0, shrink: 0, visible },
			{ component: sidebar, basis: 0, grow: 1, minSize: 1, visible: () => mode() === "panel" },
		]),
	};
}
