import Link from "next/link";

import { requireProfile } from "@/app/lib/auth/session";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { linkClass, secondaryButtonClass, readablePageClass } from "@/app/lib/styles";
import { DeleteAccountForm } from "./DeleteAccountForm";
import { SettingsForm } from "./SettingsForm";
import { profileName } from "@/app/lib/people";
import { AvatarForm } from "./AvatarForm";
import { AccessTokensPanel } from "./AccessTokensPanel";
import { listMyAccessTokens } from "@/app/lib/db/access-tokens";

const card =
  "flex flex-col gap-3 rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.08] dark:bg-zinc-950";
const body = "text-sm text-zinc-600 dark:text-zinc-400";

export default async function AccountPage() {
  const [profile, tokens] = await Promise.all([requireProfile(), listMyAccessTokens()]);

  return (
    <div className={readablePageClass}>
      <Breadcrumbs current="Account" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Account settings</h1>
        <p className={body}>
          Signed in as <span className="font-medium text-black dark:text-zinc-50">{profile.email}</span>{" "}
          with the <span className="capitalize">{profile.role}</span> role.
        </p>
      </div>

      <section className={card}>
        <AvatarForm id={profile.id} name={profileName(profile)} avatarPath={profile.avatar_path} />
      </section>

      <section className={card} aria-label="Profile and preferences">
        <SettingsForm
          email={profile.email}
          fullName={profile.full_name ?? ""}
          theme={profile.theme}
          isStaff={profile.role !== "customer"}
          queueDefaultFilter={profile.queue_default_filter}
          queueDefaultSort={profile.queue_default_sort}
        />
      </section>

      <section className={card} aria-label="Access tokens">
        <AccessTokensPanel tokens={tokens} isStaff={profile.role !== "customer"} />
      </section>

      <h2 className="mt-2 text-base font-semibold text-black dark:text-zinc-50">Your data</h2>

      <section className={card}>
        <h3 className="text-base font-semibold text-black dark:text-zinc-50">Download your data</h3>
        <p className={body}>
          A JSON file with everything this app holds that you can see: your profile and your
          tickets with their comments, plus, for staff, ticket history, your notes, assistant chats
          and the actions you took on tickets. AI triage suggestions are internal staff notes and are not
          included; ask via the address in the{" "}
          <Link href="/privacy" className={linkClass}>
            privacy policy
          </Link>{" "}
          if you need them.
        </p>
        <a href="/account/export" download className={`self-start ${secondaryButtonClass}`}>
          Download my data (JSON)
        </a>
      </section>

      <section className={`${card} border-red-200 dark:border-red-900/60`}>
        <h3 className="text-base font-semibold text-red-700 dark:text-red-400">Delete your account</h3>
        <p className={body}>
          This permanently deletes your sign-in and everything tied to it: your profile, your
          tickets and their comments, and, for staff, your notes and assistant chats. Replies you
          wrote on other people&apos;s tickets stay on those tickets without your name. There is no
          undo.
        </p>
        <p className={body}>
          Your sign-in is shared with the Notes Collections app run by the same team. Deleting it
          here deletes your account and data there as well.
        </p>
        <DeleteAccountForm email={profile.email} />
      </section>
    </div>
  );
}
