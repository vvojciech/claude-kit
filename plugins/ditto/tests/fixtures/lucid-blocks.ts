import type { Block } from '../../hooks/model'

export const LUCID_BLOCKS: Record<string, Block[]> = {
  "frontMatter": [
    {
      "kind": "code",
      "source": "---\ntitle: Release notes\ntags: [a, b]\n---\n",
      "depth": 0,
      "lang": "yaml",
      "text": "title: Release notes\ntags: [a, b]"
    },
    {
      "kind": "heading",
      "source": "# Body",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "Text",
      "depth": 0
    }
  ],
  "frontMatterProse": [
    {
      "kind": "rule",
      "source": "---\n",
      "depth": 0
    },
    {
      "kind": "heading",
      "source": "Status: all green, 3 passed.\n---",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "Details below.",
      "depth": 0
    }
  ],
  "headerOnlyTable": [
    {
      "kind": "paragraph",
      "source": "Columns:",
      "depth": 0
    },
    {
      "kind": "table",
      "source": "name | kind\n-----|-----",
      "depth": 0
    }
  ],
  "tableWithRows": [
    {
      "kind": "table",
      "source": "| a | b |\n|---|:-:|\n| 1 | 2 |\n| `x | y` | 3 |  ",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "After",
      "depth": 0
    }
  ],
  "indentedCodeAfterList": [
    {
      "kind": "list",
      "source": "- install the gem\n\n      bundle add foo",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "install the gem",
      "depth": 1
    },
    {
      "kind": "code",
      "source": "    bundle add foo",
      "depth": 1,
      "lang": "",
      "text": "bundle add foo"
    },
    {
      "kind": "paragraph",
      "source": "Then:",
      "depth": 0
    },
    {
      "kind": "code",
      "source": "    rake db:migrate",
      "depth": 0,
      "lang": "",
      "text": "rake db:migrate"
    }
  ],
  "indentedCodeAlone": [
    {
      "kind": "code",
      "source": "    bundle add foo",
      "depth": 0,
      "lang": "",
      "text": "bundle add foo"
    }
  ],
  "quote": [
    {
      "kind": "quote",
      "source": "> quoted line\n> more\n>\n> ```sh\n> make\n> ```",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "quoted line\nmore",
      "depth": 1
    },
    {
      "kind": "code",
      "source": "```sh\nmake\n```",
      "depth": 1,
      "lang": "sh",
      "text": "make"
    }
  ],
  "alert": [
    {
      "kind": "quote",
      "source": "> [!TIP]\n> Run:\n>\n> ```sh\n> make test\n> ```",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "Run:",
      "depth": 1
    },
    {
      "kind": "code",
      "source": "```sh\nmake test\n```",
      "depth": 1,
      "lang": "sh",
      "text": "make test"
    }
  ],
  "bareAlert": [
    {
      "kind": "quote",
      "source": "> [!NOTE]\n>\n> Body text",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "Body text",
      "depth": 1
    }
  ],
  "nested": [
    {
      "kind": "list",
      "source": "- one\n  - two\n    > quote\n    >\n    > | a |\n    > |---|\n    > | 1 |\n- three\n\n  ```ruby\n  puts 1\n  ```",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "one\n",
      "depth": 1
    },
    {
      "kind": "list",
      "source": "- two\n  > quote\n  >\n  > | a |\n  > |---|\n  > | 1 |",
      "depth": 1
    },
    {
      "kind": "paragraph",
      "source": "two\n",
      "depth": 2
    },
    {
      "kind": "quote",
      "source": "> quote\n>\n> | a |\n> |---|\n> | 1 |",
      "depth": 2
    },
    {
      "kind": "paragraph",
      "source": "quote",
      "depth": 3
    },
    {
      "kind": "table",
      "source": "| a |\n|---|\n| 1 |",
      "depth": 3
    },
    {
      "kind": "paragraph",
      "source": "three",
      "depth": 1
    },
    {
      "kind": "code",
      "source": "```ruby\nputs 1\n```",
      "depth": 1,
      "lang": "ruby",
      "text": "puts 1"
    }
  ],
  "deepQuote": [
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 0
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 1
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 2
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 3
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 4
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 5
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 6
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 7
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 8
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > > ```",
      "depth": 9
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > > ```",
      "depth": 10
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > > ```",
      "depth": 11
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > > ```",
      "depth": 12
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > > ```",
      "depth": 13
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > > ```",
      "depth": 14
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > > ```",
      "depth": 15
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > > make\n> > > > > > > > > > > > > > ```",
      "depth": 16
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > > ```sh\n> > > > > > > > > > > > > make\n> > > > > > > > > > > > > ```",
      "depth": 17
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > > ```sh\n> > > > > > > > > > > > make\n> > > > > > > > > > > > ```",
      "depth": 18
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > > ```sh\n> > > > > > > > > > > make\n> > > > > > > > > > > ```",
      "depth": 19
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > > ```sh\n> > > > > > > > > > make\n> > > > > > > > > > ```",
      "depth": 20
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > > ```sh\n> > > > > > > > > make\n> > > > > > > > > ```",
      "depth": 21
    },
    {
      "kind": "quote",
      "source": "> > > > > > > > ```sh\n> > > > > > > > make\n> > > > > > > > ```",
      "depth": 22
    },
    {
      "kind": "quote",
      "source": "> > > > > > > ```sh\n> > > > > > > make\n> > > > > > > ```",
      "depth": 23
    },
    {
      "kind": "code",
      "source": "> > > > > > ```sh\n> > > > > > make\n> > > > > > ```",
      "depth": 24,
      "lang": "",
      "text": "> > > > > > ```sh\n> > > > > > make\n> > > > > > ```"
    }
  ],
  "deepList": [
    {
      "kind": "list",
      "source": "- item 0\n  - item 1\n    - item 2\n      - item 3\n        - item 4\n          - item 5\n            - item 6\n              - item 7\n                - item 8\n                  - item 9\n                    - item 10\n                      - item 11\n                        - item 12\n                          - item 13\n                            - item 14\n                              - item 15\n                                - item 16\n                                  - item 17\n                                    - item 18\n                                      - item 19\n                                        - item 20\n                                          - item 21\n                                            - item 22\n                                              - item 23\n                                                - item 24\n                                                  - item 25\n                                                    - item 26\n                                                      - item 27\n                                                        - item 28\n                                                          - item 29\n                                                            - item 30\n                                                              - item 31\n                                                                - item 32\n                                                                  - item 33\n                                                                    - item 34\n                                                                      - item 35\n                                                                        - item 36\n                                                                          - item 37\n                                                                            - item 38\n                                                                              - item 39",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "item 0\n",
      "depth": 1
    },
    {
      "kind": "list",
      "source": "- item 1\n  - item 2\n    - item 3\n      - item 4\n        - item 5\n          - item 6\n            - item 7\n              - item 8\n                - item 9\n                  - item 10\n                    - item 11\n                      - item 12\n                        - item 13\n                          - item 14\n                            - item 15\n                              - item 16\n                                - item 17\n                                  - item 18\n                                    - item 19\n                                      - item 20\n                                        - item 21\n                                          - item 22\n                                            - item 23\n                                              - item 24\n                                                - item 25\n                                                  - item 26\n                                                    - item 27\n                                                      - item 28\n                                                        - item 29\n                                                          - item 30\n                                                            - item 31\n                                                              - item 32\n                                                                - item 33\n                                                                  - item 34\n                                                                    - item 35\n                                                                      - item 36\n                                                                        - item 37\n                                                                          - item 38\n                                                                            - item 39",
      "depth": 1
    },
    {
      "kind": "paragraph",
      "source": "item 1\n",
      "depth": 2
    },
    {
      "kind": "list",
      "source": "- item 2\n  - item 3\n    - item 4\n      - item 5\n        - item 6\n          - item 7\n            - item 8\n              - item 9\n                - item 10\n                  - item 11\n                    - item 12\n                      - item 13\n                        - item 14\n                          - item 15\n                            - item 16\n                              - item 17\n                                - item 18\n                                  - item 19\n                                    - item 20\n                                      - item 21\n                                        - item 22\n                                          - item 23\n                                            - item 24\n                                              - item 25\n                                                - item 26\n                                                  - item 27\n                                                    - item 28\n                                                      - item 29\n                                                        - item 30\n                                                          - item 31\n                                                            - item 32\n                                                              - item 33\n                                                                - item 34\n                                                                  - item 35\n                                                                    - item 36\n                                                                      - item 37\n                                                                        - item 38\n                                                                          - item 39",
      "depth": 2
    },
    {
      "kind": "paragraph",
      "source": "item 2\n",
      "depth": 3
    },
    {
      "kind": "list",
      "source": "- item 3\n  - item 4\n    - item 5\n      - item 6\n        - item 7\n          - item 8\n            - item 9\n              - item 10\n                - item 11\n                  - item 12\n                    - item 13\n                      - item 14\n                        - item 15\n                          - item 16\n                            - item 17\n                              - item 18\n                                - item 19\n                                  - item 20\n                                    - item 21\n                                      - item 22\n                                        - item 23\n                                          - item 24\n                                            - item 25\n                                              - item 26\n                                                - item 27\n                                                  - item 28\n                                                    - item 29\n                                                      - item 30\n                                                        - item 31\n                                                          - item 32\n                                                            - item 33\n                                                              - item 34\n                                                                - item 35\n                                                                  - item 36\n                                                                    - item 37\n                                                                      - item 38\n                                                                        - item 39",
      "depth": 3
    },
    {
      "kind": "paragraph",
      "source": "item 3\n",
      "depth": 4
    },
    {
      "kind": "list",
      "source": "- item 4\n  - item 5\n    - item 6\n      - item 7\n        - item 8\n          - item 9\n            - item 10\n              - item 11\n                - item 12\n                  - item 13\n                    - item 14\n                      - item 15\n                        - item 16\n                          - item 17\n                            - item 18\n                              - item 19\n                                - item 20\n                                  - item 21\n                                    - item 22\n                                      - item 23\n                                        - item 24\n                                          - item 25\n                                            - item 26\n                                              - item 27\n                                                - item 28\n                                                  - item 29\n                                                    - item 30\n                                                      - item 31\n                                                        - item 32\n                                                          - item 33\n                                                            - item 34\n                                                              - item 35\n                                                                - item 36\n                                                                  - item 37\n                                                                    - item 38\n                                                                      - item 39",
      "depth": 4
    },
    {
      "kind": "paragraph",
      "source": "item 4\n",
      "depth": 5
    },
    {
      "kind": "list",
      "source": "- item 5\n  - item 6\n    - item 7\n      - item 8\n        - item 9\n          - item 10\n            - item 11\n              - item 12\n                - item 13\n                  - item 14\n                    - item 15\n                      - item 16\n                        - item 17\n                          - item 18\n                            - item 19\n                              - item 20\n                                - item 21\n                                  - item 22\n                                    - item 23\n                                      - item 24\n                                        - item 25\n                                          - item 26\n                                            - item 27\n                                              - item 28\n                                                - item 29\n                                                  - item 30\n                                                    - item 31\n                                                      - item 32\n                                                        - item 33\n                                                          - item 34\n                                                            - item 35\n                                                              - item 36\n                                                                - item 37\n                                                                  - item 38\n                                                                    - item 39",
      "depth": 5
    },
    {
      "kind": "paragraph",
      "source": "item 5\n",
      "depth": 6
    },
    {
      "kind": "list",
      "source": "- item 6\n  - item 7\n    - item 8\n      - item 9\n        - item 10\n          - item 11\n            - item 12\n              - item 13\n                - item 14\n                  - item 15\n                    - item 16\n                      - item 17\n                        - item 18\n                          - item 19\n                            - item 20\n                              - item 21\n                                - item 22\n                                  - item 23\n                                    - item 24\n                                      - item 25\n                                        - item 26\n                                          - item 27\n                                            - item 28\n                                              - item 29\n                                                - item 30\n                                                  - item 31\n                                                    - item 32\n                                                      - item 33\n                                                        - item 34\n                                                          - item 35\n                                                            - item 36\n                                                              - item 37\n                                                                - item 38\n                                                                  - item 39",
      "depth": 6
    },
    {
      "kind": "paragraph",
      "source": "item 6\n",
      "depth": 7
    },
    {
      "kind": "list",
      "source": "- item 7\n  - item 8\n    - item 9\n      - item 10\n        - item 11\n          - item 12\n            - item 13\n              - item 14\n                - item 15\n                  - item 16\n                    - item 17\n                      - item 18\n                        - item 19\n                          - item 20\n                            - item 21\n                              - item 22\n                                - item 23\n                                  - item 24\n                                    - item 25\n                                      - item 26\n                                        - item 27\n                                          - item 28\n                                            - item 29\n                                              - item 30\n                                                - item 31\n                                                  - item 32\n                                                    - item 33\n                                                      - item 34\n                                                        - item 35\n                                                          - item 36\n                                                            - item 37\n                                                              - item 38\n                                                                - item 39",
      "depth": 7
    },
    {
      "kind": "paragraph",
      "source": "item 7\n",
      "depth": 8
    },
    {
      "kind": "list",
      "source": "- item 8\n  - item 9\n    - item 10\n      - item 11\n        - item 12\n          - item 13\n            - item 14\n              - item 15\n                - item 16\n                  - item 17\n                    - item 18\n                      - item 19\n                        - item 20\n                          - item 21\n                            - item 22\n                              - item 23\n                                - item 24\n                                  - item 25\n                                    - item 26\n                                      - item 27\n                                        - item 28\n                                          - item 29\n                                            - item 30\n                                              - item 31\n                                                - item 32\n                                                  - item 33\n                                                    - item 34\n                                                      - item 35\n                                                        - item 36\n                                                          - item 37\n                                                            - item 38\n                                                              - item 39",
      "depth": 8
    },
    {
      "kind": "paragraph",
      "source": "item 8\n",
      "depth": 9
    },
    {
      "kind": "list",
      "source": "- item 9\n  - item 10\n    - item 11\n      - item 12\n        - item 13\n          - item 14\n            - item 15\n              - item 16\n                - item 17\n                  - item 18\n                    - item 19\n                      - item 20\n                        - item 21\n                          - item 22\n                            - item 23\n                              - item 24\n                                - item 25\n                                  - item 26\n                                    - item 27\n                                      - item 28\n                                        - item 29\n                                          - item 30\n                                            - item 31\n                                              - item 32\n                                                - item 33\n                                                  - item 34\n                                                    - item 35\n                                                      - item 36\n                                                        - item 37\n                                                          - item 38\n                                                            - item 39",
      "depth": 9
    },
    {
      "kind": "paragraph",
      "source": "item 9\n",
      "depth": 10
    },
    {
      "kind": "list",
      "source": "- item 10\n  - item 11\n    - item 12\n      - item 13\n        - item 14\n          - item 15\n            - item 16\n              - item 17\n                - item 18\n                  - item 19\n                    - item 20\n                      - item 21\n                        - item 22\n                          - item 23\n                            - item 24\n                              - item 25\n                                - item 26\n                                  - item 27\n                                    - item 28\n                                      - item 29\n                                        - item 30\n                                          - item 31\n                                            - item 32\n                                              - item 33\n                                                - item 34\n                                                  - item 35\n                                                    - item 36\n                                                      - item 37\n                                                        - item 38\n                                                          - item 39",
      "depth": 10
    },
    {
      "kind": "paragraph",
      "source": "item 10\n",
      "depth": 11
    },
    {
      "kind": "list",
      "source": "- item 11\n  - item 12\n    - item 13\n      - item 14\n        - item 15\n          - item 16\n            - item 17\n              - item 18\n                - item 19\n                  - item 20\n                    - item 21\n                      - item 22\n                        - item 23\n                          - item 24\n                            - item 25\n                              - item 26\n                                - item 27\n                                  - item 28\n                                    - item 29\n                                      - item 30\n                                        - item 31\n                                          - item 32\n                                            - item 33\n                                              - item 34\n                                                - item 35\n                                                  - item 36\n                                                    - item 37\n                                                      - item 38\n                                                        - item 39",
      "depth": 11
    },
    {
      "kind": "paragraph",
      "source": "item 11\n",
      "depth": 12
    },
    {
      "kind": "list",
      "source": "- item 12\n  - item 13\n    - item 14\n      - item 15\n        - item 16\n          - item 17\n            - item 18\n              - item 19\n                - item 20\n                  - item 21\n                    - item 22\n                      - item 23\n                        - item 24\n                          - item 25\n                            - item 26\n                              - item 27\n                                - item 28\n                                  - item 29\n                                    - item 30\n                                      - item 31\n                                        - item 32\n                                          - item 33\n                                            - item 34\n                                              - item 35\n                                                - item 36\n                                                  - item 37\n                                                    - item 38\n                                                      - item 39",
      "depth": 12
    },
    {
      "kind": "paragraph",
      "source": "item 12\n",
      "depth": 13
    },
    {
      "kind": "list",
      "source": "- item 13\n  - item 14\n    - item 15\n      - item 16\n        - item 17\n          - item 18\n            - item 19\n              - item 20\n                - item 21\n                  - item 22\n                    - item 23\n                      - item 24\n                        - item 25\n                          - item 26\n                            - item 27\n                              - item 28\n                                - item 29\n                                  - item 30\n                                    - item 31\n                                      - item 32\n                                        - item 33\n                                          - item 34\n                                            - item 35\n                                              - item 36\n                                                - item 37\n                                                  - item 38\n                                                    - item 39",
      "depth": 13
    },
    {
      "kind": "paragraph",
      "source": "item 13\n",
      "depth": 14
    },
    {
      "kind": "list",
      "source": "- item 14\n  - item 15\n    - item 16\n      - item 17\n        - item 18\n          - item 19\n            - item 20\n              - item 21\n                - item 22\n                  - item 23\n                    - item 24\n                      - item 25\n                        - item 26\n                          - item 27\n                            - item 28\n                              - item 29\n                                - item 30\n                                  - item 31\n                                    - item 32\n                                      - item 33\n                                        - item 34\n                                          - item 35\n                                            - item 36\n                                              - item 37\n                                                - item 38\n                                                  - item 39",
      "depth": 14
    },
    {
      "kind": "paragraph",
      "source": "item 14\n",
      "depth": 15
    },
    {
      "kind": "list",
      "source": "- item 15\n  - item 16\n    - item 17\n      - item 18\n        - item 19\n          - item 20\n            - item 21\n              - item 22\n                - item 23\n                  - item 24\n                    - item 25\n                      - item 26\n                        - item 27\n                          - item 28\n                            - item 29\n                              - item 30\n                                - item 31\n                                  - item 32\n                                    - item 33\n                                      - item 34\n                                        - item 35\n                                          - item 36\n                                            - item 37\n                                              - item 38\n                                                - item 39",
      "depth": 15
    },
    {
      "kind": "paragraph",
      "source": "item 15\n",
      "depth": 16
    },
    {
      "kind": "list",
      "source": "- item 16\n  - item 17\n    - item 18\n      - item 19\n        - item 20\n          - item 21\n            - item 22\n              - item 23\n                - item 24\n                  - item 25\n                    - item 26\n                      - item 27\n                        - item 28\n                          - item 29\n                            - item 30\n                              - item 31\n                                - item 32\n                                  - item 33\n                                    - item 34\n                                      - item 35\n                                        - item 36\n                                          - item 37\n                                            - item 38\n                                              - item 39",
      "depth": 16
    },
    {
      "kind": "paragraph",
      "source": "item 16\n",
      "depth": 17
    },
    {
      "kind": "list",
      "source": "- item 17\n  - item 18\n    - item 19\n      - item 20\n        - item 21\n          - item 22\n            - item 23\n              - item 24\n                - item 25\n                  - item 26\n                    - item 27\n                      - item 28\n                        - item 29\n                          - item 30\n                            - item 31\n                              - item 32\n                                - item 33\n                                  - item 34\n                                    - item 35\n                                      - item 36\n                                        - item 37\n                                          - item 38\n                                            - item 39",
      "depth": 17
    },
    {
      "kind": "paragraph",
      "source": "item 17\n",
      "depth": 18
    },
    {
      "kind": "list",
      "source": "- item 18\n  - item 19\n    - item 20\n      - item 21\n        - item 22\n          - item 23\n            - item 24\n              - item 25\n                - item 26\n                  - item 27\n                    - item 28\n                      - item 29\n                        - item 30\n                          - item 31\n                            - item 32\n                              - item 33\n                                - item 34\n                                  - item 35\n                                    - item 36\n                                      - item 37\n                                        - item 38\n                                          - item 39",
      "depth": 18
    },
    {
      "kind": "paragraph",
      "source": "item 18\n",
      "depth": 19
    },
    {
      "kind": "list",
      "source": "- item 19\n  - item 20\n    - item 21\n      - item 22\n        - item 23\n          - item 24\n            - item 25\n              - item 26\n                - item 27\n                  - item 28\n                    - item 29\n                      - item 30\n                        - item 31\n                          - item 32\n                            - item 33\n                              - item 34\n                                - item 35\n                                  - item 36\n                                    - item 37\n                                      - item 38\n                                        - item 39",
      "depth": 19
    },
    {
      "kind": "paragraph",
      "source": "item 19\n",
      "depth": 20
    },
    {
      "kind": "list",
      "source": "- item 20\n  - item 21\n    - item 22\n      - item 23\n        - item 24\n          - item 25\n            - item 26\n              - item 27\n                - item 28\n                  - item 29\n                    - item 30\n                      - item 31\n                        - item 32\n                          - item 33\n                            - item 34\n                              - item 35\n                                - item 36\n                                  - item 37\n                                    - item 38\n                                      - item 39",
      "depth": 20
    },
    {
      "kind": "paragraph",
      "source": "item 20\n",
      "depth": 21
    },
    {
      "kind": "list",
      "source": "- item 21\n  - item 22\n    - item 23\n      - item 24\n        - item 25\n          - item 26\n            - item 27\n              - item 28\n                - item 29\n                  - item 30\n                    - item 31\n                      - item 32\n                        - item 33\n                          - item 34\n                            - item 35\n                              - item 36\n                                - item 37\n                                  - item 38\n                                    - item 39",
      "depth": 21
    },
    {
      "kind": "paragraph",
      "source": "item 21\n",
      "depth": 22
    },
    {
      "kind": "list",
      "source": "- item 22\n  - item 23\n    - item 24\n      - item 25\n        - item 26\n          - item 27\n            - item 28\n              - item 29\n                - item 30\n                  - item 31\n                    - item 32\n                      - item 33\n                        - item 34\n                          - item 35\n                            - item 36\n                              - item 37\n                                - item 38\n                                  - item 39",
      "depth": 22
    },
    {
      "kind": "paragraph",
      "source": "item 22\n",
      "depth": 23
    },
    {
      "kind": "list",
      "source": "- item 23\n  - item 24\n    - item 25\n      - item 26\n        - item 27\n          - item 28\n            - item 29\n              - item 30\n                - item 31\n                  - item 32\n                    - item 33\n                      - item 34\n                        - item 35\n                          - item 36\n                            - item 37\n                              - item 38\n                                - item 39",
      "depth": 23
    },
    {
      "kind": "code",
      "source": "item 23\n- item 24\n  - item 25\n    - item 26\n      - item 27\n        - item 28\n          - item 29\n            - item 30\n              - item 31\n                - item 32\n                  - item 33\n                    - item 34\n                      - item 35\n                        - item 36\n                          - item 37\n                            - item 38\n                              - item 39",
      "depth": 24,
      "lang": "",
      "text": "item 23\n- item 24\n  - item 25\n    - item 26\n      - item 27\n        - item 28\n          - item 29\n            - item 30\n              - item 31\n                - item 32\n                  - item 33\n                    - item 34\n                      - item 35\n                        - item 36\n                          - item 37\n                            - item 38\n                              - item 39"
    }
  ],
  "emptyFences": [
    {
      "kind": "code",
      "source": "```\n```",
      "depth": 0,
      "lang": "",
      "text": ""
    },
    {
      "kind": "code",
      "source": "```\nb\n```",
      "depth": 0,
      "lang": "",
      "text": "b"
    },
    {
      "kind": "code",
      "source": "~~~python\nprint(\"```\")\n~~~",
      "depth": 0,
      "lang": "python",
      "text": "print(\"```\")"
    }
  ],
  "crlf": [
    {
      "kind": "code",
      "source": "```js\nconst a = 1\n```",
      "depth": 0,
      "lang": "js",
      "text": "const a = 1"
    },
    {
      "kind": "table",
      "source": "| a |\n|---|\n| 1 |\n",
      "depth": 0
    }
  ],
  "mixed": [
    {
      "kind": "heading",
      "source": "# Plan",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "Run this:",
      "depth": 0
    },
    {
      "kind": "code",
      "source": "```bash\ngit status\n```",
      "depth": 0,
      "lang": "bash",
      "text": "git status"
    },
    {
      "kind": "table",
      "source": "| a | b |\n|---|---|\n| 1 | 2 |",
      "depth": 0
    },
    {
      "kind": "rule",
      "source": "---",
      "depth": 0
    },
    {
      "kind": "list",
      "source": "1. step\n2. step",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "step",
      "depth": 1
    },
    {
      "kind": "paragraph",
      "source": "step",
      "depth": 1
    }
  ],
  "infoString": [
    {
      "kind": "code",
      "source": "```Ruby title=\"x.rb\"\nputs 1\n```",
      "depth": 0,
      "lang": "ruby",
      "text": "puts 1"
    }
  ],
  "unclosed": [
    {
      "kind": "paragraph",
      "source": "Intro",
      "depth": 0
    },
    {
      "kind": "code",
      "source": "```\nhalf",
      "depth": 0,
      "lang": "",
      "text": "half"
    }
  ],
  "htmlPre": [
    {
      "kind": "code",
      "source": "<pre lang=\"py\">\nx = 1 &lt; 2\n</pre>",
      "depth": 0,
      "lang": "py",
      "text": "x = 1 < 2"
    },
    {
      "kind": "paragraph",
      "source": "After",
      "depth": 0
    }
  ],
  "htmlPreCode": [
    {
      "kind": "code",
      "source": "<pre><code class=\"language-rust\">fn main() {}\n</code></pre>",
      "depth": 0,
      "lang": "rust",
      "text": "fn main() {}"
    }
  ],
  "htmlComment": [
    {
      "kind": "paragraph",
      "source": "text",
      "depth": 0
    }
  ],
  "htmlFlow": [
    {
      "kind": "paragraph",
      "source": "<div>\n<b>hi</b> there\n</div>",
      "depth": 0
    }
  ],
  "htmlUnknownTag": [
    {
      "kind": "paragraph",
      "source": "<custom-thing>\n</custom-thing>",
      "depth": 0
    }
  ],
  "multiMessageTail": [
    {
      "kind": "code",
      "source": "    bundle add foo",
      "depth": 0,
      "lang": "",
      "text": "bundle add foo"
    }
  ],
  "setextFinished": [
    {
      "kind": "heading",
      "source": "Title\n---",
      "depth": 0
    }
  ],
  "ruleFinished": [
    {
      "kind": "paragraph",
      "source": "Text",
      "depth": 0
    },
    {
      "kind": "rule",
      "source": "***",
      "depth": 0
    }
  ],
  "footnote": [
    {
      "kind": "paragraph",
      "source": "Claim.[^1]",
      "depth": 0
    },
    {
      "kind": "paragraph",
      "source": "[^1]: note",
      "depth": 0
    }
  ],
  "footnoteCode": [
    {
      "kind": "paragraph",
      "source": "[^a]: x\n    indented",
      "depth": 0
    },
    {
      "kind": "table",
      "source": "| a |\n|---|\n| 1 |",
      "depth": 0
    }
  ]
}
