class PS_Part {
    private index: string = '';

    constructor(copy?: PS_Part) {
        if (copy !== undefined) {
            this.index = copy.index;
        }
    }
}