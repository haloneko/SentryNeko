/** Why this build could not open a database; mirrors `db::upgrade::Stranded`. */
export interface Stranded {
  /** The file the configuration still points at: the one the previous build left behind. */
  path: string;
  /** What went wrong, in the words the database gave. */
  reason: string;
}
