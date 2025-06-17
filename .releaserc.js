module.exports = {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        // Configure parser to recognize entire commit message as title
        parserOpts: {
          headerPattern: /^(.*)$/,
          headerCorrespondence: ["subject"],
        },
        // Set rules to make any commit trigger a 'patch' release
        releaseRules: [{ release: "patch" }],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        // Configure parser to recognize entire commit message as title
        parserOpts: {
          headerPattern: /^(.*)$/,
          headerCorrespondence: ["subject"],
        },
        // Customize release notes generator
        writerOpts: {
          // Function to transform commit objects
          transform: (commit) => {
            // Since commit objects cannot be modified directly, create a copy to modify
            const newCommit = { ...commit };

            // Force assign 'fix' type recognized by release notes generator
            // so that all commits are included in release notes.
            // This will display all commits under the "Bug Fixes" section.
            newCommit.type = "fix";

            return newCommit;
          },
        },
      },
    ],
    "@semantic-release/changelog",
    [
      "@semantic-release/npm",
      {
        npmPublish: true,
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["package.json", "yarn.lock", "CHANGELOG.md"],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    "@semantic-release/github",
  ],
};
