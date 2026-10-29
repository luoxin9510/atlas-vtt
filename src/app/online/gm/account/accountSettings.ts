import type { AtlasSettingSection } from '../../../settings/settingSections';
import type { AccountControl } from './AccountControl.ts';
import { accessText, accountText, HOST_KEY_SET_TEXT, NO_SERVER_TEXT, NO_HOST_KEY_TEXT, planText, UNREACHABLE_TEXT, type AccountView } from './accountView.ts';
import { isSelfHosted } from '../servers.ts';
import { t } from '../../../i18n';

/** What the account row says. */
function accountDesc(view: AccountView): string {
  switch (view.kind) {
    case 'no-server': return NO_SERVER_TEXT;
    case 'host-key': return view.set ? HOST_KEY_SET_TEXT : NO_HOST_KEY_TEXT;
    case 'waiting': return t('onlineGm.account.approve');
    case 'checking': return t('onlineGm.account.checking');
    case 'unreachable': return UNREACHABLE_TEXT;
    case 'no-access': return t('onlineGm.account.signedInRefused', { account: accountText(view.account), reason: accessText(view.reason) });
    case 'can-host': return t('onlineGm.account.signedInPlan', { account: accountText(view.account), plan: planText(view.access) });
    default: return t('onlineGm.account.signedOut');
  }
}

const signedIn = (view: AccountView): boolean => view.kind === 'no-access' || view.kind === 'can-host' || view.kind === 'unreachable' || view.kind === 'checking';

/**
 * The settings' Account section: who is signed in, what the account may host or why it may not, and
 * the way to the account page, where invite keys are redeemed and the account's data is exported and deleted.
 */
export function accountSections(account: AccountControl): AtlasSettingSection[] {
  // A self-hosted server has no account: its host key is the Host key row's.
  if (isSelfHosted()) return [];
  return [{
    heading: t('onlineGm.account.heading'),
    rows: [{
      name: t('onlineGm.account.name'),
      desc: accountDesc(account.view()),
      // The row is drawn from the account as it is now and again whenever it changes, while the settings are open.
      render: (setting) => {
        const draw = (): void => {
          const view = account.view();
          setting.setDesc(accountDesc(view));
          setting.clear();
          // The server became self-hosted or was cleared while the row stood: no account to sign in to or to open a page for.
          if (view.kind === 'host-key' || view.kind === 'no-server') return setting.settingEl.hide();
          setting.settingEl.show();
          if (signedIn(view)) setting.addButton((button) => button.setButtonText(t('onlineGm.account.signOut')).onClick(() => void account.signOut()));
          else if (view.kind === 'signed-out') setting.addButton((button) => button.setButtonText(t('onlineGm.account.signIn')).setCta().onClick(() => void account.signIn()));
          else if (view.kind === 'waiting') setting.addButton((button) => button.setButtonText(t('common.cancel')).onClick(() => account.cancelSignIn()));
          setting.addButton((button) => {
            button.setButtonText(t('onlineGm.account.openPage')).onClick(() => account.openAccountPage());
            if (view.kind === 'no-access') button.setCta();
          });
        };
        draw();
        return account.onChange(draw);
      },
    }],
  }];
}
