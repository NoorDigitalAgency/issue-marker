# Issue Marker

Used for:
- Marks the issue with the stage where the commit is merged and some metadata used by the marker

Usage:
```yaml
    steps:
      - uses: NoorDigitalAgency/release-lookup@main
        with:
          token: ${{ github.token }}
      - uses: actions/checkout@v3
        with:
          token: ${{ secrets.token }}
          fetch-depth: 0
          ref: ${{ env.RELEASE_VERSION }}
      - uses: NoorDigitalAgency/issue-marker@main
        with:
          token: ${{ secrets.token }} # Token with sufficient privilege
          reference: ${{ env.RELEASE_REFERENCE }} # Coming from NoorDigitalAgency/release-lookup@main
          version: ${{ env.RELEASE_VERSION }} # Coming from NoorDigitalAgency/release-lookup@main
          previous-version: ${{ env.RELEASE_PREVIOUS_VERSION }} # Coming from NoorDigitalAgency/release-lookup@main
          close-issues: ${{ inputs.close-issues }} # Close Issues on Merge to Production
```
