import { render } from "@react-email/render";
import { createElement } from "react";
import { WelcomeEmail } from "./welcome";
import { PasswordResetEmail } from "./password-reset";
import { VerificationCodeEmail } from "./verification-code";
import { JuryInviteEmail } from "./jury-invite";
import { JuryMagicLinkEmail } from "./jury-magic-link";
import { ApplicationReceivedEmail } from "./application-received";
import { ApplicationAcceptedEmail } from "./application-accepted";
import { ApplicationRejectedEmail } from "./application-rejected";
import { ApplicationCancelledEmail } from "./application-cancelled";
import { TeamInviteEmail } from "./team-invite";
import { JoinRequestEmail } from "./join-request";
import { CertificateEmail } from "./certificate";
import { AccountClaimEmail } from "./account-claim";
import { CreateAccountInviteEmail } from "./create-account-invite";

type WelcomeProps = Parameters<typeof WelcomeEmail>[0];
type PasswordResetProps = Parameters<typeof PasswordResetEmail>[0];
type VerificationCodeProps = Parameters<typeof VerificationCodeEmail>[0];
type JuryInviteProps = Parameters<typeof JuryInviteEmail>[0];
type JuryMagicLinkProps = Parameters<typeof JuryMagicLinkEmail>[0];
type ApplicationReceivedProps = Parameters<typeof ApplicationReceivedEmail>[0];
type ApplicationAcceptedProps = Parameters<typeof ApplicationAcceptedEmail>[0];
type ApplicationRejectedProps = Parameters<typeof ApplicationRejectedEmail>[0];
type ApplicationCancelledProps = Parameters<typeof ApplicationCancelledEmail>[0];
type TeamInviteProps = Parameters<typeof TeamInviteEmail>[0];
type JoinRequestProps = Parameters<typeof JoinRequestEmail>[0];
type CertificateProps = Parameters<typeof CertificateEmail>[0];
type AccountClaimProps = Parameters<typeof AccountClaimEmail>[0];
type CreateAccountInviteProps = Parameters<typeof CreateAccountInviteEmail>[0];

export async function renderWelcomeEmail(props: WelcomeProps): Promise<string> {
  return render(createElement(WelcomeEmail, props));
}

export async function renderPasswordResetEmail(props: PasswordResetProps): Promise<string> {
  return render(createElement(PasswordResetEmail, props));
}

export async function renderAccountClaimEmail(props: AccountClaimProps): Promise<string> {
  return render(createElement(AccountClaimEmail, props));
}

export async function renderCreateAccountInviteEmail(props: CreateAccountInviteProps): Promise<string> {
  return render(createElement(CreateAccountInviteEmail, props));
}

export async function renderVerificationCodeEmail(props: VerificationCodeProps): Promise<string> {
  return render(createElement(VerificationCodeEmail, props));
}

export async function renderJuryInviteEmail(props: JuryInviteProps): Promise<string> {
  return render(createElement(JuryInviteEmail, props));
}

export async function renderJuryMagicLinkEmail(props: JuryMagicLinkProps): Promise<string> {
  return render(createElement(JuryMagicLinkEmail, props));
}

export async function renderApplicationReceivedEmail(props: ApplicationReceivedProps): Promise<string> {
  return render(createElement(ApplicationReceivedEmail, props));
}

export async function renderApplicationAcceptedEmail(props: ApplicationAcceptedProps): Promise<string> {
  return render(createElement(ApplicationAcceptedEmail, props));
}

export async function renderApplicationRejectedEmail(props: ApplicationRejectedProps): Promise<string> {
  return render(createElement(ApplicationRejectedEmail, props));
}

export async function renderApplicationCancelledEmail(props: ApplicationCancelledProps): Promise<string> {
  return render(createElement(ApplicationCancelledEmail, props));
}

export async function renderTeamInviteEmail(props: TeamInviteProps): Promise<string> {
  return render(createElement(TeamInviteEmail, props));
}

export async function renderJoinRequestEmail(props: JoinRequestProps): Promise<string> {
  return render(createElement(JoinRequestEmail, props));
}

export async function renderCertificateEmail(props: CertificateProps): Promise<string> {
  return render(createElement(CertificateEmail, props));
}
