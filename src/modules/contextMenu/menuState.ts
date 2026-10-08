/**
 * Pure context-menu state helpers: compute the desired state of the dynamic
 * website-rule menu items and diff it against what was last applied, so only
 * real changes reach browser.contextMenus.update().
 */

export type WebsiteMenuStatus = 'blacklisted' | 'whitelisted' | 'normal';

export interface MenuItemState {
  visible: boolean;
  title?: string;
}

export type MenuState = Record<string, MenuItemState>;

/** Dynamic menu items whose visibility/title depend on the active page */
export const DYNAMIC_MENU_IDS = [
  'illa-add-blacklist-domain',
  'illa-add-blacklist-exact',
  'illa-remove-blacklist',
  'illa-add-whitelist-domain',
  'illa-add-whitelist-exact',
  'illa-remove-whitelist',
] as const;

/** State with every dynamic item hidden (invalid or non-http page) */
export function hiddenMenuState(): MenuState {
  const state: MenuState = {};
  for (const id of DYNAMIC_MENU_IDS) {
    state[id] = { visible: false };
  }
  return state;
}

/**
 * Desired state of all dynamic items for a page with the given rule status.
 */
export function computeMenuState(
  status: WebsiteMenuStatus,
  domain: string,
): MenuState {
  const state = hiddenMenuState();
  const show = (id: string, title: string) => {
    state[id] = { visible: true, title };
  };

  if (status === 'blacklisted') {
    show('illa-remove-blacklist', `Remove ${domain} from blacklist`);
    show('illa-add-whitelist-domain', `Add ${domain} to whitelist`);
    show('illa-add-whitelist-exact', 'Add current page to whitelist');
  } else if (status === 'whitelisted') {
    show('illa-remove-whitelist', `Remove ${domain} from whitelist`);
    show('illa-add-blacklist-domain', `Add ${domain} to blacklist`);
    show('illa-add-blacklist-exact', 'Add current page to blacklist');
  } else {
    show('illa-add-blacklist-domain', `Add ${domain} to blacklist`);
    show('illa-add-blacklist-exact', 'Add current page to blacklist');
    show('illa-add-whitelist-domain', `Add ${domain} to whitelist`);
    show('illa-add-whitelist-exact', 'Add current page to whitelist');
  }

  return state;
}

/**
 * Updates needed to go from `applied` to `desired`. Items unknown in
 * `applied` are always included. A hidden item keeps its old title, so a
 * title-only difference on a hidden item is not an update.
 */
export function diffMenuState(
  applied: MenuState,
  desired: MenuState,
): Array<[string, MenuItemState]> {
  const updates: Array<[string, MenuItemState]> = [];
  for (const [id, next] of Object.entries(desired)) {
    const prev = applied[id];
    const changed =
      !prev ||
      prev.visible !== next.visible ||
      (next.visible && next.title !== undefined && prev.title !== next.title);
    if (changed) updates.push([id, next]);
  }
  return updates;
}
